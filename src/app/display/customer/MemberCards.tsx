import { LEGACY_DEFAULT_INTERVAL, LEGACY_DEFAULT_RATE } from "@/lib/legacy-plus";
import { planPrice } from "@/lib/membership-rates";
import k from "./kiosk.module.css";

// The membership cards beside the order (CustomerDisplay.tsx), from what the
// register broadcasts about the member on it (lib/registerChannel.ts):
// - UnlimitedCard: a former unlimited member with nothing paying for it
//   (lib/legacy-plus.ts). Up the whole time they're on the order, until it's
//   set up or they're taken off: as a banner over the order, or filling the
//   panel while there's nothing rung up yet. Never over the order's total
//   or the check-in keypad.
// - PlusWelcomeCard: the moment it's set up.
// Only a first name comes over; the words and the price are the screen's own.

// "$15/month": the price staff set them up at unless they pick otherwise.
const PRICE = planPrice(LEGACY_DEFAULT_RATE, LEGACY_DEFAULT_INTERVAL);

export function UnlimitedCard({ firstName, hero }: { firstName: string; hero: boolean }) {
  return (
    <section className={`${k.unlimited} ${hero ? k.unlimitedHero : ""}`} role="status" aria-live="polite">
      <div className={k.unlimitedCopy}>
        <span className={k.notActive}>Not active</span>
        <h2 className={k.unlimitedTitle}>{firstName}, your unlimited membership isn&apos;t active</h2>
        <p className={k.unlimitedWhy}>
          No card on file. <b>Tap your card on the reader to restart: {PRICE}</b> <span className={k.unlimitedTax}>+ tax</span>
        </p>
        {hero && (
          <ul className={k.perks}>
            <li>🎬 Free movies</li>
            <li>10% off food &amp; drinks</li>
            <li>☕ A free coffee every day</li>
          </ul>
        )}
      </div>
      <TapIcon />
    </section>
  );
}

// A card with contactless waves: "tap here".
function TapIcon() {
  return (
    <svg className={k.tapIcon} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="18" width="34" height="24" rx="4" fill="#f8f5ec" stroke="#14110c" strokeWidth="3" />
      <rect x="11" y="24" width="8" height="6" rx="1.5" fill="#ffc72c" stroke="#14110c" strokeWidth="2" />
      <g className={k.tapWaves} stroke="#f8f5ec" strokeWidth="3.5" strokeLinecap="round">
        <path d="M46 22c3 3 4.6 6.4 4.6 10s-1.6 7-4.6 10" />
        <path d="M52 16c4.6 4.6 7 10 7 16s-2.4 11.4-7 16" />
      </g>
    </svg>
  );
}

export function PlusWelcomeCard({ firstName, hero }: { firstName: string; hero: boolean }) {
  return (
    <section className={`${k.plusWelcome} ${hero ? k.unlimitedHero : ""}`} role="status" aria-live="polite">
      <span className={k.plusSeal} aria-hidden="true">
        +
      </span>
      <div className={k.unlimitedCopy}>
        <h2 className={k.unlimitedTitle}>🎉 {firstName}, you&apos;re Insiders+!</h2>
        <p className={k.unlimitedWhy}>Free movies and 10% off start right now. Enjoy the show.</p>
      </div>
    </section>
  );
}
