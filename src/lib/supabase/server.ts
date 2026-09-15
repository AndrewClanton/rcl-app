import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Use in Server Components, Server Functions, and Route Handlers.
// Reads/writes the user's auth session via cookies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component with no way to write cookies.
            // Safe to ignore when proxy.ts is refreshing the session.
          }
        },
      },
    }
  );
}
