import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { supabaseConfigured } from "@/lib/supabase/config";

export async function middleware(request: NextRequest) {
  // If Supabase isn't fully configured (URL *and* key), do nothing — the app
  // still runs locally. Checking the URL alone once crashed every request
  // when only the key was missing.
  if (!supabaseConfigured) return;
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
