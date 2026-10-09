import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageMasthead } from "@/components/print";
import { openEmailToken, UNSUBSCRIBE_PATH } from "@/lib/email/tokens";
import { currentMemberId } from "@/lib/member-forward";
import Unsubscribe from "./Unsubscribe";

// Where every marketing email's "Unsubscribe" link lands (the path kept
// its old name so links in emails already sent still work). The signed
// token in the link says who, so no sign-in is needed. There are no email
// choices on the site (owner's call, 10/9): the link unsubscribes, and the
// page offers a way back in.
//
// Private: hidden from search engines, not counted in page views.
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const token = one((await searchParams).t);
  const t = openEmailToken(token);
  const member = t
    ? // A link from before the account was merged into another: the account it became.
      (await createAdminClient().from("members").select("id, erased_at").eq("id", (await currentMemberId(t.memberId)) ?? t.memberId).maybeSingle()).data
    : null;

  if (!t || !member || member.erased_at) {
    return (
      <div className="mx-auto max-w-xl">
        <PageMasthead eyebrow="Email from Royale Cinema" title="This link doesn't open" className="!mb-6" />
        <p className="text-[15px]">
          It may have been cut off when it was copied. Open the Unsubscribe link from the email again, use your mail app&apos;s own Unsubscribe button, or reply to any
          of our emails (or write to info@royalecinemajoplin.com) and we&apos;ll take you off by hand.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageMasthead eyebrow="Email from Royale Cinema" title="Unsubscribe" className="!mb-6" />
      <Unsubscribe token={token} oneClickAction={`${UNSUBSCRIBE_PATH}?t=${token}`} />
    </div>
  );
}
