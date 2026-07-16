/**
 * Whether Supabase is wired up. NEXT_PUBLIC_* vars are inlined at build time,
 * so this is safe to read in the browser. When false, the app still runs
 * (cleansing works offline); only account/insights features are hidden.
 *
 * The key accepts either name: NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy JWT
 * anon key) or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Supabase's newer
 * sb_publishable_* key) — supabase-js treats them interchangeably. Both
 * references must stay direct member accesses so Next can inline them.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = !!supabaseUrl && !!supabaseKey;
