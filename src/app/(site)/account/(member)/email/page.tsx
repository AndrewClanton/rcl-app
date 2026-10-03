import type { Metadata } from "next";
import { requireMember } from "@/lib/member-auth";
import { maskEmail } from "@/lib/contact-mask";
import { emailStateFor } from "@/lib/email/consent";
import { UNSUBSCRIBE_PATH } from "@/lib/email/tokens";
import EmailPreferences from "../../../email/preferences/EmailPreferences";
import { Panel } from "../ui";

// The email preference center for a signed-in member: the same screen an
// email's "Email preferences" link opens, without the link.
export const metadata: Metadata = { title: "Your emails", robots: { index: false, follow: false } };

export default async function AccountEmailPage() {
  const member = await requireMember();
  const state = await emailStateFor(member.id);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Panel title="Email from the Royale">
        <p className="p-5 text-[15px] text-[var(--muted)]">
          What we send to <strong className="text-[var(--foreground)]">{maskEmail(member.email) ?? "your address"}</strong>. Receipts, tickets and account emails always come.
        </p>
      </Panel>
      <EmailPreferences token={null} unsubscribeAction={UNSUBSCRIBE_PATH} initial={state} />
    </div>
  );
}
