import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { quotaFor } from "@/lib/plans";

export const runtime = "nodejs";

export interface UsageResponse {
  authed: boolean;
  plan?: string;
  used?: number;
  limit?: number;
  remaining?: number;
}

/** Today's AI-insight usage for the signed-in user (for quota display). */
export async function GET() {
  if (!supabaseConfigured) {
    return NextResponse.json({ authed: false } satisfies UsageResponse);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ authed: false } satisfies UsageResponse);

  const today = new Date().toISOString().slice(0, 10); // UTC, matches SQL
  const [{ data: profile }, { data: usage }] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", user.id).single(),
    supabase
      .from("usage_daily")
      .select("count")
      .eq("user_id", user.id)
      .eq("day", today)
      .maybeSingle(),
  ]);

  const plan = profile?.plan ?? "free";
  const limit = quotaFor(plan);
  const used = usage?.count ?? 0;
  return NextResponse.json({
    authed: true,
    plan,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  } satisfies UsageResponse);
}
