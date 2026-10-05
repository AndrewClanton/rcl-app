import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewTerms, TERMS_EFFECTIVE_DATE, TERMS_PUBLISHED } from "@/lib/legal";
import LegalPage from "@/components/LegalPage";
import { pageMeta } from "@/lib/seo/page-meta";

export const metadata = pageMeta({
  title: "Terms of service",
  description: "The terms for using the Royale Cinema Lounge website, your account, Insiders+ and points.",
  path: "/terms",
  noindex: !TERMS_PUBLISHED,
});

const link = "font-bold text-[var(--accent)] hover:underline";

// Meta's app settings ask for a terms of service link for Facebook sign-in.
// Written in plain words to match the privacy policy; only what the site and
// the register actually do today. Admin-only until TERMS_PUBLISHED.
export default async function TermsPage() {
  if (!(await canViewTerms())) notFound();

  return (
    <LegalPage
      title="Terms of service"
      effectiveDate={TERMS_EFFECTIVE_DATE}
      draft={!TERMS_PUBLISHED}
      intro={
        <p>
          These terms cover the Royale Cinema Lounge website, your Royale Cinema account, Insiders and Insiders+ memberships, and points. Royale Cinema
          Lounge LLC, 715 E Broadway, Joplin, MO 64801 (&ldquo;we&rdquo;, &ldquo;Royale Cinema&rdquo;) runs them. By making an account or buying
          something from us online, you agree to them.
        </p>
      }
    >
      <section>
        <h2 id="account">Your account</h2>
        <ul>
          <li>Use your real name and an email address and phone number that are yours. One account per person.</li>
          <li>
            You can sign in with a password, or with Google or Facebook. Keep your sign-in to yourself; you&apos;re responsible for what happens on
            your account.
          </li>
          <li>If we find two accounts for the same person, we may combine them, keeping all the points and history from both.</li>
        </ul>
      </section>

      <section>
        <h2 id="membership">Insiders and Insiders+</h2>
        <ul>
          <li>
            The current perks and prices are on the{" "}
            <Link href="/membership" className={link}>
              membership page
            </Link>
            .
          </li>
          <li>
            Insiders+ renews automatically, monthly or yearly, until you cancel. You can cancel any time from the Billing tab of{" "}
            <Link href="/account" className={link}>
              your account
            </Link>
            .
          </li>
          <li>Senior and student rates are set at the box office after we check an ID in person.</li>
          <li>
            Perks are for the member and can&apos;t be traded for cash. If we change a price, we&apos;ll tell you before your next payment at the
            new price.
          </li>
        </ul>
      </section>

      <section>
        <h2 id="points">Points</h2>
        <ul>
          <li>Members earn points on what they buy, as shown on the membership page and in your points history.</li>
          <li>Points have no cash value and can&apos;t be sold or moved to someone else.</li>
          <li>When a purchase is refunded or voided, the points it earned are taken back. We may correct points given by mistake.</li>
          <li>We may change how points are earned or spent. We&apos;ll post any change here and on the membership page first.</li>
        </ul>
      </section>

      <section>
        <h2 id="buying">Buying online</h2>
        <ul>
          <li>Prices, including tax, are shown before you pay. Card payments are processed by Stripe.</li>
          <li>Tickets and booth bookings are for the date and time you choose. To change or cancel one, email us or ask at the box office.</li>
        </ul>
      </section>

      <section>
        <h2 id="visiting">At Royale Cinema</h2>
        <ul>
          <li>Alcohol is served only to guests 21 and over with a valid ID, and we can refuse service.</li>
          <li>Be kind to the crew and other guests, and treat the lounge, its tapes and its screens with care.</li>
        </ul>
      </section>

      <section>
        <h2 id="profile">Your profile</h2>
        <ul>
          <li>Your photo and profile line are yours. You let us show them where you choose: on your account, on the check-in tablet, and on your shared profile page if you turn it on.</li>
          <li>Don&apos;t post anything that isn&apos;t yours to post, or that&apos;s hateful, explicit or illegal. We can hide or remove anything that is.</li>
        </ul>
      </section>

      <section>
        <h2 id="site">Using the website</h2>
        <p>
          Don&apos;t try to get into accounts or parts of the site that aren&apos;t yours, interfere with how it runs, or copy it in bulk. We can
          suspend accounts that do.
        </p>
      </section>

      <section>
        <h2 id="privacy">Your information</h2>
        <p>
          The{" "}
          <Link href="/privacy" className={link}>
            privacy policy
          </Link>{" "}
          explains what we collect and why. You can ask us to delete your account any time; here&apos;s{" "}
          <Link href="/data-deletion" className={link}>
            how
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 id="limits">The fine print</h2>
        <ul>
          <li>
            We work hard to keep the site and its information right, but it&apos;s provided as is, and showtimes and menus can change. As far as the
            law allows, Royale Cinema isn&apos;t liable for indirect losses from using the site, and our total liability is limited to what you paid us
            in the 12 months before the claim.
          </li>
          <li>These terms are governed by the laws of Missouri.</li>
          <li>If we change these terms, we&apos;ll post the new version here with a new date.</li>
        </ul>
      </section>

      <section>
        <h2 id="contact">Questions</h2>
        <p>
          Email <strong>info@royalecinemajoplin.com</strong> or ask us at the box office.
        </p>
      </section>
    </LegalPage>
  );
}
