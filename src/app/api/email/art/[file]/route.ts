import type { NextRequest } from "next/server";
import { ART } from "@/lib/email/designs/assets";
import { drawArt } from "@/lib/email/designs/art-draw";
import { openArtName } from "@/lib/email/designs/art-token";
import { assetUrl } from "@/lib/email/designs/kit";

// The pictures in the ready-made invite emails that carry the reader's
// first name (lib/email/designs): the door tablet's "Sam, your first
// check-in!", the profile screen's "Sam, you're checked in" and the VHS tape
// labeled with their name. Drawn when the email is opened
// (lib/email/designs/art-draw.ts).
//
// /api/email/art/<piece>-<d|m>.<hash>.<ext>?n=<sealed first name>
//
// The name is sealed (lib/email/designs/art-token.ts). With no name, or one
// that isn't ours, it's the picture with no name in it, from the bucket.
// Public on purpose (mail apps fetch it); one name always gives the same
// address, so it's cached for good.
export const runtime = "nodejs";

const FILE = /^(door|profile|tape)-(d|m)\.([0-9a-f]{10})\.(png|jpg)$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = FILE.exec(file);
  const v = m ? ART[m[1]]?.[m[2] as "d" | "m"] : undefined;
  if (!m || !v) return new Response("Not found", { status: 404 });
  const name = openArtName(req.nextUrl.searchParams.get("n"));
  if (!name) return new Response(null, { status: 302, headers: { Location: assetUrl(v.generic), "Cache-Control": "public, max-age=86400" } });
  try {
    const body = await drawArt(v, name);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": v.ext === "jpg" ? "image/jpeg" : "image/png",
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    console.error("email art:", e instanceof Error ? e.message : e);
    return new Response(null, { status: 302, headers: { Location: assetUrl(v.generic), "Cache-Control": "no-store" } });
  }
}
