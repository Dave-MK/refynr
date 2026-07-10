/**
 * Billing plans and their daily AI-insight quotas.
 *
 * This is the ONE place the free/paid limits live. During validation the free
 * tier is generous; to monetise later, drop `free.insightsPerDay` and point a
 * Stripe checkout at setting a user's `plan` to `pro`. The API route and the
 * SQL metering functions never change — only these numbers do.
 */

export type Plan = "free" | "pro";

export const PLANS: Record<Plan, { label: string; insightsPerDay: number }> = {
  // Generous while we validate — feels unlimited to a real user, still bounded.
  free: { label: "Free", insightsPerDay: 50 },
  // Effectively unlimited (avoid Infinity so it round-trips through JSON/SQL).
  pro: { label: "Pro", insightsPerDay: 100_000 },
};

/** Hard ceiling on total insights calls per day across ALL users — the
 *  wallet kill-switch. Sized so normal traffic never hits it. */
export const GLOBAL_DAILY_CAP = 500;

export function isPlan(value: string): value is Plan {
  return value === "free" || value === "pro";
}

export function quotaFor(plan: string): number {
  return (isPlan(plan) ? PLANS[plan] : PLANS.free).insightsPerDay;
}
