import Link from "next/link";
import Image from "next/image";
import { PageMasthead, Seal, SpecFoot, Sprockets } from "@/components/print";
import { pageMeta } from "@/lib/seo/page-meta";

// No data and nothing per visitor: built once, served static.
export const dynamic = "force-static";

export const metadata = pageMeta({
  title: "About",
  description:
    "Joplin's only independent film center: a third space for the Joplin community to celebrate the art of cinema, in a historic 1920 building on Route 66.",
  path: "/about",
});

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border)] px-5 py-4 last:border-b-0">
      <dt className="font-display text-lg leading-snug">{q}</dt>
      <dd className="mt-1.5 text-[15px] text-[var(--muted)]">{children}</dd>
    </div>
  );
}

const PILLARS: [string, string, React.ReactNode][] = [
  [
    "01",
    "Our mission",
    "We strive to provide a third space for the Joplin community by presenting and preserving both independent and classic films to cultivate an appreciation for cinema.",
  ],
  [
    "02",
    "The concept",
    "We're not a restaurant, but we have food to pair with your movie. We're not a beer garden, but we offer draft beers to enjoy in both our indoor and outdoor cinemas. We're not a cocktail bar, but we craft concessions and specialty drinks to give every guest a great experience.",
  ],
  [
    "03",
    "Our location",
    "We're on Langston Hughes Broadway & Historic Route 66 in Joplin, MO. Our building is one of the oldest in the city, originally opening in August 1920 and housing a cinema more than once since.",
  ],
  [
    "04",
    "Video lounge",
    "Our lounge boasts an extensive VHS film archive, a haven for film enthusiasts and nostalgia seekers. Members have exclusive access any time they visit: revisit old favorites, or discover hidden gems.",
  ],
];

export default function AboutPage() {
  return (
    <div className="space-y-16">
      <PageMasthead
        eyebrow="About"
        title="Joplin's only independent film center"
        intro="Royale Cinema Lounge showcases independent releases and repertory cinema with a curated beverage and concessions menu: a third space for the Joplin community to celebrate the art of cinema in a personal, curated way."
        className="!mb-0"
      />

      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        {/* Panel Pop photo plate, with its registration note at the corner. */}
        <div className="relative mx-auto w-full max-w-sm lg:mx-0">
          <div className="sheet crop relative aspect-[2/3] !border-4 !shadow-[7px_7px_0_var(--foreground)]">
            <div className="print-photo absolute inset-0 overflow-hidden rounded-[2px]">
              <Image src="/photos/hero-couple.jpg" alt="Guests at Royale Cinema Lounge" fill sizes="(min-width: 1024px) 380px, 80vw" className="object-cover" priority />
            </div>
          </div>
          <Seal className="absolute -right-4 -bottom-6 z-[2]">
            Joplin
            <br />
            Route 66
          </Seal>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {PILLARS.map(([n, title, body]) => (
            <section key={n} className="sheet crop p-5">
              <div className="spec-code">{n}</div>
              <h2 className="font-display mt-1 text-xl">{title}</h2>
              <p className="mt-2 text-[15px] text-[var(--muted)]">{body}</p>
            </section>
          ))}
        </div>
      </div>

      <Sprockets />

      <div className="sheet crop relative aspect-[21/9]">
        <div className="print-photo absolute inset-0 overflow-hidden rounded-[4px]">
          <Image src="/photos/lounge-booths.png" alt="Booth seating and the film poster wall inside Royale Cinema Lounge" fill sizes="1000px" className="object-cover" />
        </div>
      </div>

      <section id="faq" className="site-anchor sheet crop">
        <h2 className="spec-head rounded-t-[4px]">
          <span>Frequently asked questions</span>
        </h2>
        <dl>
          <FaqItem q="Why don't you publish a full public schedule?">
            We don&apos;t advertise every screening. That&apos;s what lets us bring in a much wider range of films, at a lower cost, than a typical theater could justify. Members always know
            what&apos;s playing here first. And if there&apos;s something specific you want to see on the big screen, email us at{" "}
            <span className="font-bold select-all">info@royalecinemajoplin.com</span>. Odds are, we can get it for you.
          </FaqItem>
          <FaqItem q="What films will you be screening?">
            Everything from modern indie hits to classics spanning the last 60 years, plus new independent features every week. Let us know if there&apos;s something you want to see and
            we&apos;ll try to bring it to Joplin.
          </FaqItem>
          <FaqItem q="Is RCL family friendly?">Yes. Many of our films are suitable for all ages. Check individual movie ratings and descriptions before planning a visit with your family.</FaqItem>
          <FaqItem q="Do you serve food and drink?">
            Yes: a curated selection of snacks, soft drinks, craft beers, wine from Eagles Landing (a local vineyard), and select specialty cocktails. Outside food and drinks aren&apos;t
            permitted.
          </FaqItem>
          <FaqItem q="Do you host special events?">
            Yes: movie marathons, themed nights, filmmaker Q&amp;As, and private rentals for screenings and parties. See our{" "}
            <Link href="/events" className="font-bold text-[var(--accent)] hover:underline">
              private events
            </Link>{" "}
            page for pricing.
          </FaqItem>
        </dl>
        <SpecFoot />
      </section>

      <section className="sheet ht-ink-red relative flex flex-wrap items-center gap-6 !bg-[var(--foreground)] p-6 text-[var(--background)]">
        <Seal className="relative z-[1]">
          Route
          <br />
          66
        </Seal>
        <div className="relative z-[1] text-[15px]">
          <span className="ctag ctag-yellow">Visit us</span>
          <div className="font-display mt-3 text-2xl">715 E Broadway, Joplin, MO 64801</div>
          <div className="mt-1">
            <a href="tel:+14172814172" className="font-bold hover:text-[var(--gold)]">
              417-281-4172
            </a>
            {" · "}
            <a href="mailto:info@royalecinemajoplin.com" className="font-bold hover:text-[var(--gold)]">
              info@royalecinemajoplin.com
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
