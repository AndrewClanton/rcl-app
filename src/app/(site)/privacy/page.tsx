import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewLegalPages, LEGAL_EFFECTIVE_DATE, LEGAL_PAGES_PUBLISHED } from "@/lib/legal";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Royale Cinema Lounge collects about you, why, who helps us handle it, and your choices.",
  robots: LEGAL_PAGES_PUBLISHED ? undefined : { index: false, follow: false },
};

const SECTIONS = [
  { id: "collect", title: "What we collect" },
  { id: "dont-collect", title: "What we don't collect" },
  { id: "use", title: "How we use it" },
  { id: "share", title: "Who we share it with" },
  { id: "keep", title: "How long we keep it" },
  { id: "choices", title: "Your choices" },
  { id: "children", title: "Children" },
  { id: "security", title: "Security" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact us" },
];

export default async function PrivacyPage() {
  if (!(await canViewLegalPages())) notFound();

  return (
    <LegalPage
      title="Privacy policy"
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      draft={!LEGAL_PAGES_PUBLISHED}
      sections={SECTIONS}
      intro={
        <>
          <p>
            Royale Cinema Lounge (&ldquo;we&rdquo;) runs this website, our member program (Royale Insiders and Insiders+), and the register and screens
            at 715 E Broadway in Joplin, Missouri. This policy explains what we collect about you, why, who helps us handle it, and the choices you
            have.
          </p>
          <p className="mt-3">
            The short version: we collect what we need to run your membership, sell you tickets and food, and keep your points straight. We
            don&apos;t sell your information, and we don&apos;t use advertising trackers.
          </p>
        </>
      }
    >
      <section>
        <h2 id="collect">What we collect</h2>
        <ul>
          <li>
            <strong>Account details:</strong> your name, email address, and phone number if you give us one. If you set a password, our sign-in
            provider stores it in scrambled (hashed) form. We never see it.
          </li>
          <li>
            <strong>Your photo,</strong> if you add one to your account.
          </li>
          <li>
            <strong>Your profile, if you fill it in:</strong> a short profile line, your check-in effect (a favorite color and an animation), and, if you
            share a profile page, the name and link you choose for it.
          </li>
          <li>
            <strong>If you sign in with Google or Facebook:</strong> your name, email address and profile photo from that account. We don&apos;t get
            your password, contacts, friends or posts.
          </li>
          <li>
            <strong>Purchases:</strong> what you buy at the bar, kitchen and box office when your account is attached, tickets you buy online, and the
            amounts, tips and taxes, and whether you paid by cash or card.
          </li>
          <li>
            <strong>Points:</strong> every point you earn or use, and any adjustment, with the reason.
          </li>
          <li>
            <strong>Membership:</strong> whether you&apos;re an Insider or Insider+, your rate, and your billing status. If staff give you the senior
            or student rate, they check your ID in person. We record that the rate was set and which staff member set it, but we don&apos;t copy or
            keep your ID.
          </li>
          <li>
            <strong>Visits:</strong> screenings you have tickets for, and the days you make a purchase with your account attached.
          </li>
          <li>
            <strong>Email preferences:</strong> whether you want our weekly lineup emails.
          </li>
          <li>
            <strong>Page visits:</strong> which pages of this site are opened and how long they stay on screen, counted anonymously with a random number kept
            in your browser (not a cookie, and not tied to your name or account), and not at all if your browser asks sites not to track it.
          </li>
          <li>
            <strong>Technical information:</strong> cookies that keep you signed in, and standard server logs (such as IP address and browser type)
            that our hosting providers keep for security and troubleshooting.
          </li>
        </ul>
      </section>

      <section>
        <h2 id="dont-collect">What we don&apos;t collect</h2>
        <ul>
          <li>We don&apos;t store card numbers. Card payments are handled by Stripe.</li>
          <li>We don&apos;t use advertising cookies or ad-tracking pixels, and we don&apos;t sell or trade your information with data brokers.</li>
        </ul>
      </section>

      <section>
        <h2 id="use">How we use it</h2>
        <ul>
          <li>To run your account and membership, including Insiders+ billing.</li>
          <li>To keep your points balance and history accurate.</li>
          <li>To give you receipts and yearly statements.</li>
          <li>
            To recognize you at the register. Staff can look you up by name, email, phone number, the QR code in your account, or your photo. The
            register also suggests members who visit often, with their photos, so staff can find them quickly.
          </li>
          <li>
            To greet you when you check in. After staff confirm it&apos;s you, the screen facing you shows your first name and points, your profile line
            if you wrote one, and the check-in effect you picked.
          </li>
          <li>
            <strong>For your profile page, only if you turn it on.</strong> It&apos;s off unless you switch it on in your account. It shows the name you
            choose for it, your photo, your profile line, your badges and the date you earned each (just the month for the early and late check-in
            badges, and just the year for your birthday one), how many weeks in a row and how many times you&apos;ve visited, when you joined, and the
            movies you&apos;ve seen with us (this year&apos;s releases by name, older films only as a count). It catches up once a day, so it never
            shows that you&apos;re here today. It never shows your email, phone, full name (unless you type it as your page&apos;s name), points,
            purchases, the time of day you check in, or tickets for upcoming shows. Anyone with the link can see it, and we keep it out of search
            engines. Turn it off or change its link anytime on the Profile tab of your account; the old link stops working right away, and we hold it
            for 90 days so no one else can take it over. Our staff can hide a profile line, or turn off a page, if it&apos;s offensive.
          </li>
          <li>
            To send the emails you ask for (the weekly lineup and member news) and account emails such as receipts, sign-in links and billing
            notices.
          </li>
          <li>To keep the website and our records secure, and to meet our tax and legal obligations.</li>
        </ul>
      </section>

      <section>
        <h2 id="share">Who we share it with</h2>
        <p>We share information only with companies that help us run the Royale, and only what they need to do their job:</p>
        <ul>
          <li>
            <strong>Supabase</strong> stores our database and handles sign-in.
          </li>
          <li>
            <strong>Vercel</strong> hosts this website.
          </li>
          <li>
            <strong>Stripe</strong> processes card payments and Insiders+ billing. Stripe handles your card details under its own{" "}
            <a href="https://stripe.com/privacy" className="font-bold text-[var(--accent)] hover:underline">
              privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Our email service provider</strong> sends the emails you&apos;ve signed up for.
          </li>
          <li>
            <strong>Google or Facebook,</strong> only if you choose to sign in with them.
          </li>
        </ul>
        <p>
          We don&apos;t sell or rent your personal information. We may share information if the law requires it, or when it&apos;s needed to protect
          our customers, staff or business.
        </p>
      </section>

      <section>
        <h2 id="keep">How long we keep it</h2>
        <p>
          We keep your account while it&apos;s active. We keep purchase and payment records for as long as we need them for tax and accounting.
        </p>
        <p>
          If you ask us to delete your account, we delete your profile, photo, contact details, points and sign-in connections. We remove your name
          from the purchase records we&apos;re required to keep. See <Link href="/data-deletion" className="font-bold text-[var(--accent)] hover:underline">Deleting your data</Link>.
        </p>
      </section>

      <section>
        <h2 id="choices">Your choices</h2>
        <ul>
          <li>See and update your details anytime on the Profile tab of your account.</li>
          <li>Add, change or remove your photo anytime.</li>
          <li>Turn your profile page on or off, change its link, and change or clear your profile line and check-in effect, on the Profile tab.</li>
          <li>Turn off the weekly emails in your account, or with the unsubscribe link in any of those emails.</li>
          <li>
            Ask for a copy of your information, or to delete your account, by emailing info@royalecinemajoplin.com. See{" "}
            <Link href="/data-deletion" className="font-bold text-[var(--accent)] hover:underline">
              Deleting your data
            </Link>
            .
          </li>
        </ul>
      </section>

      <section>
        <h2 id="children">Children</h2>
        <p>
          Accounts are for people 13 and older. We don&apos;t knowingly collect information from children under 13. If you think a child under 13 has
          given us information, contact us and we&apos;ll delete it.
        </p>
      </section>

      <section>
        <h2 id="security">Security</h2>
        <p>
          Only staff who need it can see member information, and our staff screens are behind sign-in. Our providers encrypt information as it
          travels between your device and our systems. No system is perfectly secure, so use a strong password that you don&apos;t use anywhere else,
          or sign in with Google or Facebook.
        </p>
      </section>

      <section>
        <h2 id="changes">Changes to this policy</h2>
        <p>
          If we change this policy, we&apos;ll post the new version here with a new effective date. If a change is significant, we&apos;ll also let
          members know by email.
        </p>
      </section>

      <section>
        <h2 id="contact">Contact us</h2>
        <p>
          Questions about your information? Email info@royalecinemajoplin.com, call 417-281-4172, or stop by the box office at 715 E Broadway,
          Joplin, MO 64801.
        </p>
      </section>
    </LegalPage>
  );
}
