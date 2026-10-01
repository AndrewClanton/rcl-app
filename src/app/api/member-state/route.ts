import { NextResponse } from "next/server";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks } from "@/lib/plus-status";

// Whether the visitor is a signed-in Insiders+ member, for the public site's
// header badge and the Insiders+ pitches (components/site/SiteHeaderSync.tsx).
// Asked by the browser after the page loads, so the public pages themselves
// never read the login cookie and can be cached for everyone. Says nothing
// else about the member.
export async function GET() {
  const member = await getSignedInMember();
  return NextResponse.json({ plus: !!member && hasPlusPerks(member) }, { headers: { "Cache-Control": "private, no-store" } });
}
