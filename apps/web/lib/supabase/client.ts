import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/config";

/** Supabase client for use in Client Components (browser). */
export function createClient() {
  return createBrowserClient(supabaseUrl!, supabaseKey!);
}
