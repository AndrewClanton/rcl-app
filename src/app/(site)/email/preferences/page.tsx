import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageMasthead } from "@/components/print";
import { maskEmail } from "@/lib/contact-mask";
import { emailStateFor } from "@/lib/email/consent";
import { firstNameOf } from "@/lib/email/format";
import { openEmailToken, UNSUBSCRIBE_PATH } from "@/lib/email/tokens";
import { currentMemberId } from "@/lib/member-forward";
import EmailPreferences from "./EmailPreferences";

// "Email from the Royale": where every email's "Email preferences" and
// "Unsubscribe" links land. The signed token in the link says whose
// settings these are, so no sign-in is needed. It shows a first name and a
// shortened address (s•••@gmail.com), never the whole address, and the
// address can't be changed here.
//
// Private: hidden from search engines, not counted in page views.
export const metadata: Metadata = { title: "Email from the Royale", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function EmailPreferencesPage({ searchParams }: { searchParams: Promise<{ t?: string | string[]; done?: string | string[] }> }) {
  const p = await searchParams;
  const token = one(p.t);
  const t = openEmailToken(token);
  const member = t
    ? // A link from before the account was merged into another: the account it became.
      (await createAdminClient().from("members").select("id, name, email, erased_at").eq("id", (await currentMemberId(t.memberId)) ?? t.memberId).maybeSingle()).data
    : null;

  if (!t || !member || member.erased_at) {
    return (
      <div className="mx-auto max-w-xl">
        <PageMasthead eyebrow="Email from the Royale" title="This link doesn't open" className="!mb-6" />
        <p className="text-[15px]">
          It may have been cut off when it was copied. Open the link from the email again, or{" "}
          <Link href="/account/email" className="font-bold text-[var(--accent)] hover:underline">
            sign in to change your emails
          </Link>
          . You can also reply to any of our emails, or write to info@royalecinemajoplin.com, and we&apos;ll take you off by hand.
        </p>
      </div>
    );
  }

  const state = await emailStateFor(member.id);
  const first = firstNameOf(member.name);
  return (
    <div className="mx-auto max-w-xl">
      <PageMasthead
        eyebrow="Email from the Royale"
        title={first ? `Hi, ${first}.` : "Your emails"}
        intro={
          <>
            Choose what we send to <strong className="break-all">{maskEmail(member.email) ?? "your address"}</strong>. To change the address itself, sign in to your
            account or ask us at the box office.
          </>
        }
        className="!mb-6"
      />
      <EmailPreferences token={token} unsubscribeAction={`${UNSUBSCRIBE_PATH}?t=${token}`} initial={state} justUnsubscribed={one(p.done) === "unsubscribed"} />
    </div>
  );
}
