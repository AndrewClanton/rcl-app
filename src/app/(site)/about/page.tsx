function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="card-flat">
      <div className="font-medium">{q}</div>
      <div className="mt-1 text-sm text-[var(--muted)]">{children}</div>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">About</div>
        <h1 className="font-display text-3xl font-semibold">Joplin&apos;s only independent film center</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Royale Cinema Lounge showcases independent releases and repertory cinema with a curated beverage and concessions menu — a
          third space for the Joplin community to celebrate the art of cinema in a personal, curated way.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="font-display mb-2 text-lg font-semibold">Our mission</h2>
          <p className="text-sm text-[var(--muted)]">
            We strive to provide a third space for the Joplin community by presenting and preserving both independent and classic
            films to cultivate an appreciation for cinema.
          </p>
        </div>
        <div className="card">
          <h2 className="font-display mb-2 text-lg font-semibold">The concept</h2>
          <p className="text-sm text-[var(--muted)]">
            We&apos;re not a restaurant, but we have food to pair with your movie. We&apos;re not a beer garden, but we offer draft
            beers to enjoy in both our indoor and outdoor cinemas. We&apos;re not a cocktail bar, but we craft concessions and
            specialty drinks to give every guest a great experience.
          </p>
        </div>
        <div className="card">
          <h2 className="font-display mb-2 text-lg font-semibold">Our location</h2>
          <p className="text-sm text-[var(--muted)]">
            We&apos;re on Langston Hughes Broadway &amp; Historic Route 66 in Joplin, MO. Our building is one of the oldest in the
            city, originally opening in August 1920 and housing a cinema more than once since.
          </p>
        </div>
        <div className="card">
          <h2 className="font-display mb-2 text-lg font-semibold">Video lounge</h2>
          <p className="text-sm text-[var(--muted)]">
            Our lounge boasts an extensive VHS film archive — a haven for film enthusiasts and nostalgia seekers. Members have
            exclusive access any time they visit: revisit old favorites, or discover hidden gems.
          </p>
        </div>
      </div>

      <div>
        <h2 className="font-display mb-4 text-2xl font-semibold">Frequently asked questions</h2>
        <div className="space-y-3">
          <FaqItem q="What films will you be screening?">
            Everything from modern indie hits to classics spanning the last 60 years, plus new independent features every week. Let
            us know if there&apos;s something you want to see — we&apos;ll try to bring it to Joplin.
          </FaqItem>
          <FaqItem q="Is RCL family friendly?">
            Yes — many of our films are suitable for all ages. Check individual movie ratings and descriptions before planning a
            visit with your family.
          </FaqItem>
          <FaqItem q="Do you serve food and drink?">
            Yes — a curated selection of snacks, soft drinks, craft beers, wine from Eagles Landing (a local vineyard), and select
            specialty cocktails. Outside food and drinks aren&apos;t permitted.
          </FaqItem>
          <FaqItem q="Do you host special events?">
            Yes — movie marathons, themed nights, filmmaker Q&amp;As, and private rentals for screenings and parties. See our{" "}
            <a href="/events" className="text-[var(--accent)] hover:underline">
              private events
            </a>{" "}
            page for pricing.
          </FaqItem>
        </div>
      </div>

      <div className="card">
        <h2 className="font-display mb-2 text-lg font-semibold">Visit us</h2>
        <div className="text-sm text-[var(--muted)]">
          <div>715 E Broadway, Joplin, MO 64801</div>
          <div>
            <a href="tel:+14172814172" className="hover:text-[var(--accent)]">
              417-281-4172
            </a>
          </div>
          <div>
            <a href="mailto:info@royalecinemajoplin.com" className="hover:text-[var(--accent)]">
              info@royalecinemajoplin.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
