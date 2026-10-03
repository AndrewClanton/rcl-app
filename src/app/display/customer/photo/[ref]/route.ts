import { assertDisplayScreen } from "@/lib/auth";
import { openTabletPhoto } from "@/lib/tablet-photo";
import { getMemberPhoto } from "@/lib/member-profile-server";

// The photo on a member's card on the customer screen (MemberCards.tsx), by
// the sealed reference the register sent (lib/tablet-photo.ts): never the
// photo's stored address, which holds the member id. Only for a signed-in
// screen or staff login, like the screen itself. Re-encoded, with the
// camera's metadata stripped.
export const dynamic = "force-dynamic";

const NOT_FOUND = { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } };

export async function GET(_req: Request, ctx: RouteContext<"/display/customer/photo/[ref]">) {
  try {
    await assertDisplayScreen();
  } catch {
    return new Response("Not found", NOT_FOUND);
  }
  const { ref } = await ctx.params;
  const memberId = openTabletPhoto(ref);
  const photo = memberId ? await getMemberPhoto(memberId).catch(() => null) : null;
  if (!photo) return new Response("Not found", NOT_FOUND);
  return new Response(new Uint8Array(photo), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=600",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
