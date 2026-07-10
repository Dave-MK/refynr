"use client";

import Link from "next/link";
import { useUser } from "@/lib/supabase/useUser";
import { supabaseConfigured } from "@/lib/supabase/config";

/** Header auth widget: email + sign-out when in, a Sign-in link when out. */
export function AuthNav() {
  const { user, loading } = useUser();

  if (!supabaseConfigured || loading) return null;

  if (!user) {
    return (
      <Link
        href="/login"
        className="font-mono text-xs font-semibold text-teal transition hover:text-cyan"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden font-mono text-[11px] text-dim sm:inline">
        {user.email}
      </span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="font-mono text-xs text-dim transition hover:text-body"
        >
          sign out
        </button>
      </form>
    </div>
  );
}
