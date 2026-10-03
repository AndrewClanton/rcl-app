import { type NextRequest } from "next/server";
import { handleClick } from "@/lib/email/clicks";

// A link in a Royale email: /e/<send id>/<link number>. Records the click
// (lib/email/clicks.ts) and redirects to the link stored on the campaign,
// never anywhere else.
export const dynamic = "force-dynamic";

function go(url: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ send: string; i: string }> }) {
  const { send, i } = await ctx.params;
  return go(await handleClick(send, i, "GET"));
}

// Link checkers ask with HEAD: answered, and counted as a scanner.
export async function HEAD(_req: NextRequest, ctx: { params: Promise<{ send: string; i: string }> }) {
  const { send, i } = await ctx.params;
  return go(await handleClick(send, i, "HEAD"));
}
