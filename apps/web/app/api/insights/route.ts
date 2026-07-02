import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { HealthScore, TableProfile } from "@refynr/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI insight endpoint. Receives ONLY column profiles, finding summaries, and
 * scores — never the dataset itself. Deterministic rules find and fix issues;
 * this layer explains what they mean.
 */

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

function buildPrompt(body: InsightRequest): string {
  const columns = body.profile.columns
    .map(
      (c) =>
        `- "${c.name}": type=${c.type} (confidence ${c.typeConfidence}), ${c.nonEmpty} values, ${c.empty} empty, ${c.distinct} distinct, samples: ${c.samples.map((s) => JSON.stringify(s)).join(", ")}`,
    )
    .join("\n");
  const findings = body.findings
    .map((f) => `- [${f.severity}] ${f.title} (rule: ${f.rule})`)
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

export async function POST(request: Request) {
  let body: InsightRequest;
  try {
    body = (await request.json()) as InsightRequest;
    if (!body?.profile?.columns || !Array.isArray(body.findings)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
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
      return NextResponse.json(
        { error: "The AI returned no usable output. Try again." },
        { status: 502 },
      );
    }

    const insights = JSON.parse(text.text) as InsightResponse;
    return NextResponse.json(insights);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
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
