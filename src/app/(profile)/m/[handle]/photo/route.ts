import { getProfilePhoto } from "@/lib/member-profile-server";

// A shared profile's photo, by handle. The stored photo's own address
// holds the member id (which works like a password at the door), so the
// page never shows it: this route checks the page is shared, re-encodes
// the photo (camera metadata stripped) and sends the bytes. Not found
// once sharing is off. The page links it with ?v=<version>, so a new photo
// is a new address; a browser keeps one for a minute, and shared caches
// none, so turning the page off takes effect almost at once.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/m/[handle]/photo">) {
  const { handle } = await ctx.params;
  const photo = await getProfilePhoto(handle);
  if (!photo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return new Response(new Uint8Array(photo), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
