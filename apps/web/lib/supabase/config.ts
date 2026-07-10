/**
 * Whether Supabase is wired up. NEXT_PUBLIC_* vars are inlined at build time,
 * so this is safe to read in the browser. When false, the app still runs
 * (cleansing works offline); only account/insights features are hidden.
 */
export const supabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
