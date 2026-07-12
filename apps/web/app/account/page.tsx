import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { quotaFor, PLANS, type Plan } from "@/lib/plans";

export default async function AccountPage() {
  if (!supabaseConfigured) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account");

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: profile }, { data: usage }] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", user.id).single(),
    supabase
      .from("usage_daily")
      .select("count")
      .eq("user_id", user.id)
      .eq("day", today)
      .maybeSingle(),
  ]);

  const plan = (profile?.plan ?? "free") as Plan;
  const limit = quotaFor(plan);
  const used = usage?.count ?? 0;
  const remaining = Math.max(0, limit - used);

  return (
    <main className="mx-auto max-w-[640px] px-5 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-[22px] font-bold tracking-tight text-hi">
          refynr<span className="text-teal">.</span>
        </Link>
        <form action="/auth/signout" method="post">
          <button className="font-mono text-xs text-dim transition hover:text-body">
            sign out
          </button>
        </form>
      </header>

      <h1 className="text-lg font-semibold text-hi">Account</h1>
      <p className="mt-1 text-sm text-mut">{user.email}</p>

      <div className="mt-6 rounded-2xl border border-line bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="label">Plan</h2>
            <p className="mt-1 text-sm text-body">{PLANS[plan]?.label ?? plan}</p>
          </div>
          <span className="pill border-teal/30 bg-teal/10 text-teal">{plan}</span>
        </div>

        {/* AI insights temporarily disabled — usage readout hidden.
        <div className="mt-6 border-t border-line pt-6">
          <h2 className="label">AI insights today</h2>
          <p className="mt-1 text-sm text-body">
            {used} used ·{" "}
            <span className="text-hi">{remaining}</span> of {limit} remaining
          </p>
          <p className="mt-2 font-mono text-[11px] text-dim">
            Resets daily at 00:00 UTC.
          </p>
        </div>
        */}
      </div>

      <Link
        href="/"
        className="mt-6 inline-block font-mono text-xs text-dim transition hover:text-body"
      >
        ← back to refynr
      </Link>
    </main>
  );
}
