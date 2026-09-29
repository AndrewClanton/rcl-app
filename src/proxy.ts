import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/print (the printers' poll: no login cookie, asked every few seconds)
     * - image files
     */
    "/((?!_next/static|_next/image|favicon.ico|api/print/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
