import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewLegalPages, LEGAL_EFFECTIVE_DATE, LEGAL_PAGES_PUBLISHED } from "@/lib/legal";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Deleting your data",
  description: "How to ask Royale Cinema Lounge to delete your account and the information attached to it.",
  robots: LEGAL_PAGES_PUBLISHED ? undefined : { index: false, follow: false },
};

// Meta requires a public "user data deletion instructions" page for any app
// that offers Facebook sign-in; this is it.
export default async function DataDeletionPage() {
  if (!(await canViewLegalPages())) notFound();

  return (
    <LegalPage
      title="Deleting your data"
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      draft={!LEGAL_PAGES_PUBLISHED}
      intro={<p>You can ask us to delete your Royale account, and the personal information attached to it, at any time.</p>}
    >
      <section>
        <h2 id="how">How to ask</h2>
        <ol className="space-y-3">
          {[
            <>
              Email <strong>info@royalecinemajoplin.com</strong> from the email address on your account, with the subject &ldquo;Delete my
              account.&rdquo; Or ask us at the box office.
            </>,
            <>We&apos;ll confirm it&apos;s really you. If you have Insiders+, we&apos;ll cancel it so you aren&apos;t billed again.</>,
            <>We&apos;ll delete your account within 30 days and email you when it&apos;s done.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-4 !ml-0 !list-none">
              <span className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white">{i + 1}</span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 id="deleted">What gets deleted</h2>
        <ul>
          <li>Your name, email address and phone number</li>
          <li>Your photo</li>
          <li>Your sign-in connections: password, Google and Facebook</li>
          <li>Your points and points history</li>
          <li>Your email preferences</li>
        </ul>
      </section>

      <section>
        <h2 id="kept">What we keep</h2>
        <p>
          Records of purchases and payments that we&apos;re required to keep for tax and accounting, with your name and contact details removed.
          Stripe keeps its own records of card payments under its own{" "}
          <a href="https://stripe.com/privacy" className="font-bold text-[var(--accent)] hover:underline">
            privacy policy
          </a>
          .
        </p>
      </section>

      <section>
        <h2 id="before">Before you delete</h2>
        <ul>
          <li>Points can&apos;t be restored once your account is deleted.</li>
          <li>
            Download any receipts or yearly statements you want to keep from the Purchases and Billing tabs of{" "}
            <Link href="/account" className="font-bold text-[var(--accent)] hover:underline">
              your account
            </Link>
            .
          </li>
        </ul>
      </section>

      <section>
        <h2 id="facebook-google">If you signed in with Facebook or Google</h2>
        <p>
          You can remove the Royale from your Facebook account (Settings &amp; privacy, then Settings, then Apps and websites) or your Google account
          (myaccount.google.com, then Security, then your connections to third-party apps). That stops them from sharing new information with us, but
          it doesn&apos;t delete what we already have. To do that, send us the request above.
        </p>
      </section>

      <section>
        <h2 id="fewer-emails">Just want fewer emails?</h2>
        <p>
          You don&apos;t need to delete your account for that. Turn off the weekly emails on the Profile tab of your account, or use the unsubscribe
          link in any of those emails.
        </p>
      </section>
    </LegalPage>
  );
}
