import type { PlusFinish } from "@/lib/checkin";
import { isPlusFinishUrl } from "@/lib/plus-finish-link";
import { RATE_ORDER, planPrice } from "@/lib/membership-rates";
import ClaimQr from "./ClaimQr";
import k from "./kiosk.module.css";

// "Add your card on your phone": a former unlimited member's Insiders+
// link (lib/legacy-plus.ts), sent by the register when staff choose "On
// their phone". Shown beside the order, clear of the keypad, until they've
// paid, staff take it down, or two minutes pass.
export interface FinishShown {
  key: number;
  firstName: string;
  url: string;
  plan: string; // "$15/month"
}

// What the register sent, checked: only ever one of our finish links, and
// the plan in the screen's own words (never text off the channel). Null
// for anything else.
export function finishShown(p: Partial<PlusFinish> | null | undefined): FinishShown | null {
  if (!p || typeof p.firstName !== "string" || !isPlusFinishUrl(p.url)) return null;
  const tier = p.tier && RATE_ORDER.includes(p.tier) ? p.tier : "adult";
  return { key: Date.now(), firstName: p.firstName.slice(0, 40), url: p.url, plan: planPrice(tier, p.interval === "year" ? "year" : "month") };
}

export default function FinishCard({ shown }: { shown: FinishShown }) {
  return (
    <div className={`${k.ticketsCard} ${k.finishCard}`} aria-live="polite">
      <ClaimQr url={shown.url} size={168} label="QR code: add your card for Insiders+ on your phone" />
      <div className={k.finishCopy}>
        <div className={k.ticketsHead}>{shown.firstName}, add your card on your phone</div>
        <div className={k.ticketMeta}>Insiders+ · {shown.plan} plus tax · unlimited movies</div>
        <div className={k.finishScan}>Scan with your phone&apos;s camera</div>
      </div>
    </div>
  );
}
