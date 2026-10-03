import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session cookie on every request so server
// components always see an up-to-date session. Called from src/proxy.ts.
//
// A response that sets the login cookies must never be stored by a shared
// cache: the new access and refresh tokens would be handed to the next
// visitor. Several public pages are cacheable now (Menu, Events, About...),
// so the no-cache headers @supabase/ssr hands over with the cookies
// (Cache-Control: private, no-store, plus Expires and Pragma) go on the
// response with them.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Everything written so far: setAll rebuilds the response each time, and
  // the library only passes the headers with its first write.
  const cookieWrites = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const noCacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach((cookie) => cookieWrites.set(cookie.name, cookie));
          Object.assign(noCacheHeaders, headers);
          response = NextResponse.next({ request });
          cookieWrites.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(noCacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    }
  );

  // Refreshes the session if expired. Required for Server Components,
  // which can't write cookies themselves.
  await supabase.auth.getUser();

  return response;
}
