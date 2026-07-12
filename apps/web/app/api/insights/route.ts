import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { HealthScore, TableProfile } from "@refynr/engine";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/config";
import { GLOBAL_DAILY_CAP, quotaFor } from "@/lib/plans";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI insight endpoint. Receives ONLY column profiles, finding summaries, and
 * scores — never the dataset itself. Deterministic rules find and fix issues;
 * this layer explains what they mean.
 *
 * TEMPORARILY DISABLED: this is a paid endpoint (per-call AI cost), off until
 * we settle free vs. paywalled access. It is OFF unless REFYNR_INSIGHTS_ENABLED
 * is set to "1", so it can never incur cost by default. The full implementation
 * below is untouched — flip the env var (or the default here) to restore it.
 * The UI entry point (the "AI insights" tab) is commented out in AnalysisPanel.
 */
const INSIGHTS_ENABLED = process.env.REFYNR_INSIGHTS_ENABLED === "1";

interface InsightRequest {
  profile: TableProfile;
  findings: { rule: string; severity: string; title: string; count: number }[];
  score: HealthScore;
  projectedScore: HealthScore;
}

export interface InsightResponse {
  summary: string;
  likelyOrigin: string;
  recommendations: string[];
  riskLevel: "low" | "medium" | "high";
}

const MISSING_KEY_MESSAGE =
  "AI insights need an Anthropic API key. Add ANTHROPIC_API_KEY to apps/web/.env.local and restart the dev server.";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "2-3 sentence executive summary of the dataset's quality, written for a business stakeholder. Concrete, specific to the findings, no hedging.",
    },
    likelyOrigin: {
      type: "string",
      description:
        "One sentence hypothesizing where this data came from and why it's in this state (e.g. merged from multiple systems, manual entry, OCR export).",
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description:
        "3-5 prioritized, actionable recommendations beyond the automatic fixes. Each one sentence.",
    },
    riskLevel: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "Overall risk of using this data as-is for business decisions or imports.",
    },
  },
  required: ["summary", "likelyOrigin", "recommendations", "riskLevel"],
  additionalProperties: false,
} as const;

// Caps keep the prompt bounded regardless of what a client sends —
// this endpoint costs money per call, so inputs are never trusted for size.
const MAX_COLUMNS = 100;
const MAX_FINDINGS = 50;
const MAX_SAMPLE_LENGTH = 80;

function buildPrompt(body: InsightRequest): string {
  const columns = body.profile.columns
    .slice(0, MAX_COLUMNS)
    .map(
      (c) =>
        `- "${String(c.name).slice(0, MAX_SAMPLE_LENGTH)}": type=${c.type} (confidence ${c.typeConfidence}), ${c.nonEmpty} values, ${c.empty} empty, ${c.distinct} distinct, samples: ${(c.samples ?? [])
          .slice(0, 5)
          .map((s) => JSON.stringify(String(s).slice(0, MAX_SAMPLE_LENGTH)))
          .join(", ")}`,
    )
    .join("\n");
  const findings = body.findings
    .slice(0, MAX_FINDINGS)
    .map((f) => `- [${f.severity}] ${String(f.title).slice(0, 200)} (rule: ${f.rule})`)
    .join("\n");

  return `You are the AI analyst inside refynr, a spreadsheet data-quality tool. A deterministic rules engine has already profiled a spreadsheet and generated findings. Your job is to interpret the results for the user.

Dataset: ${body.profile.rowCount} rows × ${body.profile.columnCount} columns.
Health score: ${body.score.overall}/100 now, ${body.projectedScore.overall}/100 if all proposed fixes are accepted.
Dimension scores: ${body.score.dimensions.map((d) => `${d.label} ${d.score} (${d.issues} issues)`).join(", ")}.

Columns:
${columns}

Findings:
${findings}

Interpret this for the user. Be specific to what you see — reference actual column names and finding counts. Do not restate the findings list; add insight the rules engine cannot: what the data probably is, where it likely came from, what the issues imply about upstream processes, and what to do beyond the automatic fixes.`;
}

/**
 * Auth + quota gate. Returns the user id (to reserve/refund against) or an
 * error response to send straight back. When Supabase isn't configured (local
 * dev without accounts) the gate is skipped so the tool still works offline.
 */
type Gate =
  | { ok: true; userId: string | null }
  | { ok: false; response: NextResponse };

async function enforceEntitlement(plan: string): Promise<Gate> {
  if (!supabaseConfigured) return { ok: true, userId: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sign in to generate AI insights." },
        { status: 401 },
      ),
    };
  }

  // Trust the user's own plan row (RLS-guarded); default to free.
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_insight", {
    p_user_id: user.id,
    p_quota: quotaFor(profile?.plan ?? plan),
    p_global_cap: GLOBAL_DAILY_CAP,
  });

  if (error) {
    console.error("[insights] consume_insight failed:", error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Couldn't check your usage. Try again shortly." },
        { status: 503 },
      ),
    };
  }

  const result = data as { allowed: boolean; reason?: string };
  if (!result.allowed) {
    if (result.reason === "global_cap") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "AI insights are busy right now — please try again later." },
          { status: 503 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You've used all your AI insights for today. They reset tomorrow." },
        { status: 402 },
      ),
    };
  }

  return { ok: true, userId: user.id };
}

/** Give back a reserved call when the AI request itself fails. */
async function refund(userId: string | null) {
  if (!userId) return;
  try {
    await createAdminClient().rpc("refund_insight", { p_user_id: userId });
  } catch (e) {
    console.error("[insights] refund failed:", e);
  }
}

export async function POST(request: Request) {
  if (!INSIGHTS_ENABLED) {
    return NextResponse.json(
      { error: "AI insights are temporarily unavailable." },
      { status: 503 },
    );
  }

  let body: InsightRequest;
  try {
    body = (await request.json()) as InsightRequest;
    if (!body?.profile?.columns || !Array.isArray(body.findings)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const gate = await enforceEntitlement("free");
  if (!gate.ok) return gate.response;

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    await refund(gate.userId);
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
  }

  try {
    const response = await client.messages.create({
      model: process.env.REFYNR_AI_MODEL ?? "claude-opus-4-8",
      max_tokens: 2048,
      output_config: {
        format: {
          type: "json_schema",
          schema: OUTPUT_SCHEMA,
        },
      },
      messages: [{ role: "user", content: buildPrompt(body) }],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      await refund(gate.userId);
      return NextResponse.json(
        { error: "The AI returned no usable output. Try again." },
        { status: 502 },
      );
    }

    const insights = JSON.parse(text.text) as InsightResponse;
    return NextResponse.json(insights);
  } catch (error) {
    await refund(gate.userId);
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
    }
    if (
      error instanceof Anthropic.BadRequestError &&
      /credit balance/i.test(error.message)
    ) {
      return NextResponse.json(
        {
          error:
            "Your Anthropic account has no API credits. Add credits at platform.claude.com → Plans & Billing (API billing is separate from a Claude subscription), then try again.",
        },
        { status: 402 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "AI rate limit reached — try again in a minute." },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `AI service error (${error.status}). Try again shortly.` },
        { status: 502 },
      );
    }
    console.error("[insights] AI request failed:", error);
    const message = error instanceof Error ? error.message : "";
    if (/api key|auth|credential/i.test(message)) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Couldn't reach the AI service. Check your network and API key." },
      { status: 502 },
    );
  }
}
