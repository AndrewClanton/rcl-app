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
            <strong>Your profile quote,</strong> if you write one: the short line you can add to your account. Staff see it at the register and on
            your member record. It isn&apos;t shown on the website or to other customers.
          </li>
          <li>
            <strong>Your birthday,</strong> if you add it: the month and day only, never the year. It&apos;s for the Birthday Visit badge when you
            check in during your birthday week.
          </li>
          <li>
            <strong>If you sign in with Google or Facebook:</strong> your name, email address and profile photo from that account. We don&apos;t get
            your password, contacts, friends or posts.
          </li>
          <li>
            <strong>Accounts moved over from our old systems:</strong> if you had an account on our old website, or with Indy, the ticketing system we
            used before this one, we brought your name, email address and phone number over to your Insiders account, with your account number from
            that system so the two stay matched. From the old website we also noted whether you paid for a membership there, and your senior or
            student rate if you had one. From Indy we also brought your birthday (the month and day only, never the year) and your answer to
            Indy&apos;s email questions. If you already had an account here, we only filled in what was missing. We didn&apos;t bring over addresses,
            passwords or payment details.
          </li>
          <li>
            <strong>Purchases:</strong> what you buy at the bar, kitchen and box office when your account is attached, tickets you buy online, and the
            amounts, tips and taxes, and whether you paid by cash or card.
          </li>
          <li>
            <strong>Checkout details, even without an account:</strong> the name and email address you give when you buy tickets online, and the name,
            email address and phone number (if you give one) when you reserve a booth.
          </li>
          <li>
            <strong>Private event requests:</strong> your name and email address, and what you tell us about the event: its name, the date and time,
            the space, how many guests, and any movie or food.
          </li>
          <li>
            <strong>Bar tabs:</strong> the name you give staff for your tab, and anything staff type in for a special order. If you keep a card on a
            tab, Stripe holds the card. We only see its type and last four digits.
          </li>
          <li>
            <strong>Check-in at the register:</strong> if you check in for points on the customer screen, the phone number you type in. If we
            don&apos;t know that number yet, we also get the first name you type (and your email address, only if you choose to give it), and that
            becomes your Insiders account once staff confirm it. Staff confirm every check-in at the register. We record the day you checked in, which
            staff member confirmed it, and any points or rewards it earned.
          </li>
          <li>
            <strong>Tickets at the door:</strong> when staff scan the code on a ticket you bought online, we record when it was scanned and which
            staff member scanned it, and your tickets print. Each ticket prints only once. If the ticket is on your account, the scan also checks you
            in for the day. When staff scan the QR code in your account, it checks you in the same way and brings up your tickets for that
            day&apos;s shows.
          </li>
          <li>
            <strong>Claiming your account:</strong> if your account doesn&apos;t have a website login yet (say it was made when you checked in, or
            moved over from our old website or Indy), the customer screen can show you a QR code after you check in, and your receipt can have one.
            The code opens a page that shows only your first name and asks for the last four digits of the phone number on your account. Then you
            sign in with Google or an email and password, and that login is attached to your account. A code on the customer screen lasts 30
            minutes, one on a receipt lasts two weeks, and each works once. We record when each code was made and used, which login used it, and
            how many wrong digits were tried; after 10 wrong tries it stops working. If your account had no email address, we add the one your login
            confirmed.
          </li>
          <li>
            <strong>Gift memberships:</strong> if you buy someone Insiders+ as a gift, your name and email address (for your receipt), and any note you
            add. The person you give it to sees your name and your note. If someone gives you a gift, we record who it came from.
          </li>
          <li>
            <strong>Points and badges:</strong> every point you earn or use, and any adjustment, with the reason, and the badges you earn when you
            check in.
          </li>
          <li>
            <strong>Membership:</strong> whether you&apos;re an Insider or Insider+, your rate, and your billing status. If staff give you the senior
            or student rate, they check your ID in person. We record that the rate was set and which staff member set it, but we don&apos;t copy or
            keep your ID.
          </li>
          <li>
            <strong>Visits:</strong> screenings you have tickets for, the days you check in, and the days you make a purchase with your account
            attached.
          </li>
          <li>
            <strong>Email preferences:</strong> whether you want our weekly lineup emails.
          </li>
          <li>
            <strong>Page visits:</strong> which pages of this site are opened and how long they stay on screen, counted anonymously with a random number kept
            in your browser (not a cookie, and not tied to your name or account), and not at all if your browser asks sites not to track it. We also
            note the kind of device (phone, tablet or computer) and the website that sent you here, if any. We don&apos;t record your name or IP
            address with these counts.
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
            register also suggests members who visit often, with their photos, so staff can find them quickly. When you check in, the register shows
            staff your photo, your name and the last four digits of your phone number, so they can confirm it&apos;s you.
          </li>
          <li>
            To greet you at checkout. The customer-facing screen by the register shows your order as it&apos;s rung up, with the name on it. Once
            staff confirm your check-in, it also shows your first name and points balance.
          </li>
          <li>To hold your tickets and booth, and to answer your private event request.</li>
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
            <strong>Resend</strong> delivers the emails we send you, such as booth confirmations and gift membership receipts.
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
          Ticket bookings, booth reservations, private event requests and gift memberships are kept with our sales records, for the same reason.
        </p>
        <p>Anonymous page-visit counts are deleted after 13 months.</p>
        {/* DRAFT PLACEHOLDER for Andrew: replace [DATE] in the last sentence below with the date the unused old-website and Indy records will
            be deleted, before this merges. */}
        <p>
          The records from our old website and from Indy that we didn&apos;t bring over are kept apart from member accounts, where only the
          Royale&apos;s owners and admins can see them, and are deleted after the move. We&apos;ll delete them by [DATE].
        </p>
        <p>
          If you ask us to delete your account, we delete your profile, photo, profile quote, birthday, contact details, points, badges and sign-in
          connections, and any copy of your account from our old website or Indy. We also remove your name and contact details from the records
          we&apos;re required to keep: your purchases, bar tabs, ticket and booth bookings, private event requests, gift memberships you bought, and
          your customer details at Stripe (Stripe keeps its own payment records for tax purposes). The days you checked in stay only as anonymous
          counts. See{" "}
          <Link href="/data-deletion" className="font-bold text-[var(--accent)] hover:underline">
            Deleting your data
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 id="choices">Your choices</h2>
        <ul>
          <li>See and update your details anytime on the Profile tab of your account.</li>
          <li>Add, change or remove your photo and your profile quote anytime.</li>
          <li>Checking in for points is up to you. You can still buy anything without an account.</li>
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
          Accounts are for people 13 and older. That includes an account made on this website, by staff at the register, or by checking in on the
          customer screen. We don&apos;t ask for your age, and we don&apos;t knowingly collect information from children under 13. A parent or
          guardian can buy tickets or book a booth for a younger child under their own name. If you think a child under 13 has given us information,
          contact us and we&apos;ll delete it.
        </p>
      </section>

      <section>
        <h2 id="security">Security</h2>
        <p>
          Only staff who need it can see member information, and our staff screens are behind sign-in. When cashiers look you up, they see only part
          of your email address and phone number; managers see the full details when they need them, for billing or a request like yours. Our providers encrypt
          information as it
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
