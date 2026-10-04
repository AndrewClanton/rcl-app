import type { ReaderPrompt, RegisterCartSnapshot } from "@/lib/registerChannel";
import { isGuestName } from "@/lib/member-name";
import p from "./payreader.module.css";

// "Finish on the card reader": the whole customer screen while a card
// payment waits on the reader (the register's PaymentModal says so in the
// cart, as `reader`). Guests kept tapping their card on this screen, and
// tapping it on the reader before the tip (the reader asks for the tip
// first, so that tap does nothing). So: one big instruction, a drawing of
// the reader, and the steps in order. No arrow: the reader sits on the
// counter below the screen's stand, so any arrow pointed the wrong way.
// The order shrinks to a strip at the foot.
//
// Steps: "Pick a tip on the reader", then "Then tap, insert or swipe your
// card". No tip asked (taken on the register already): only the card. A
// tab's card on file: only the tip. Stripe doesn't say when the tip is
// picked, so both stay up as equals until a card's been tried (step
// "card"), then the tip is ticked and the card step lights up.
//
// approved: the card went through ("card-approved"): a big tick for a
// moment, with the usual "approved" sound (CustomerDisplay).
export default function PayOnReader({ prompt, cart, approved = false }: { prompt: ReaderPrompt; cart: RegisterCartSnapshot | null; approved?: boolean }) {
  const steps: { key: string; text: string; state: "todo" | "done" | "now" }[] = [];
  const past = prompt.step === "card";
  if (prompt.tip) steps.push({ key: "tip", text: "Pick a tip on the reader", state: prompt.card && past ? "done" : "todo" });
  if (prompt.card) steps.push({ key: "card", text: `${prompt.tip ? "Then tap" : "Tap"}, insert or swipe your card on the reader`, state: past ? "now" : "todo" });
  const numbered = steps.length > 1;

  return (
    <div className={`${p.screen} ${approved ? p.approved : ""}`} role="status" aria-live="polite">
      <div className={p.head}>
        {approved ? (
          <>
            <div className={p.tick} aria-hidden="true">
              ✓
            </div>
            <h1 className={p.title}>Approved</h1>
            <p className={p.sub}>Thank you! Don&apos;t forget your card.</p>
          </>
        ) : (
          <>
            <div className={p.eyebrow}>Almost done</div>
            <h1 className={p.title}>Finish on the card reader</h1>
          </>
        )}
      </div>

      <div className={p.art} aria-hidden="true">
        <ReaderArt tip={prompt.tip && !approved} card={prompt.card} />
      </div>

      {!approved && (
        <div className={p.stepsWrap}>
          <ol className={p.steps}>
            {steps.map((s, i) => (
              <li key={s.key} className={`${p.step} ${s.state === "now" ? p.stepNow : s.state === "done" ? p.stepDone : ""}`}>
                <span className={p.num} aria-hidden="true">
                  {s.state === "done" ? "✓" : numbered ? i + 1 : "→"}
                </span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className={p.note}>This screen doesn&apos;t take cards.</p>
        </div>
      )}

      {cart && cart.items.length > 0 && <OrderStrip cart={cart} tip={prompt.tip && !approved} />}
    </div>
  );
}

// The rest of the order, small: whose it is, what's on it, the total.
function OrderStrip({ cart, tip }: { cart: RegisterCartSnapshot; tip: boolean }) {
  const who = cart.member;
  const name = who && !isGuestName(who.firstName) ? `${who.firstName}'s order` : cart.orderName || "Your order";
  const items = cart.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name}`).join(" · ");
  const earn = who ? (cart.pointsToEarn ?? 0) : 0;
  return (
    <div className={p.order}>
      <div className={p.orderWhat}>
        <div className={p.orderName}>{name}</div>
        <div className={p.orderItems}>{items}</div>
      </div>
      {earn > 0 && <span className={p.orderEarn}>+{earn} pts</span>}
      <div className={p.orderTotal}>
        <span className={p.orderTotalLabel}>{tip ? "Total before tip" : "Total"}</span>
        <span className={p.orderAmount}>${cart.total.toFixed(2)}</span>
      </div>
    </div>
  );
}

// A countertop card reader, our own drawing (no real product or logo): a
// small device with a screen (tip choices, or just the amount), the tap
// waves beside it, and a card going into the slot at its foot.
function ReaderArt({ tip, card }: { tip: boolean; card: boolean }) {
  return (
    <svg className={p.reader} viewBox="0 0 230 300">
      {/* shadow on the counter */}
      <ellipse cx="110" cy="286" rx="86" ry="9" fill="rgba(0,0,0,0.45)" />
      {/* the body */}
      <rect x="40" y="26" width="140" height="232" rx="20" fill="#2b241b" stroke="#ffc72c" strokeWidth="5" />
      <rect x="52" y="38" width="116" height="150" rx="8" fill="#f3ecd9" />
      {/* the screen: "Add a tip?" and three choices, or just the amount */}
      <rect x="64" y="52" width="92" height="10" rx="5" fill="#14110c" opacity="0.75" />
      {tip ? (
        <>
          <rect x="64" y="76" width="92" height="22" rx="7" fill="#ffc72c" stroke="#14110c" strokeWidth="2" />
          <rect x="64" y="104" width="92" height="22" rx="7" fill="#ffc72c" stroke="#14110c" strokeWidth="2" />
          <rect x="64" y="132" width="92" height="22" rx="7" fill="#ffc72c" stroke="#14110c" strokeWidth="2" />
        </>
      ) : (
        <rect x="70" y="92" width="80" height="34" rx="8" fill="#ed1c24" opacity="0.9" />
      )}
      <rect x="84" y="164" width="52" height="8" rx="4" fill="#b9ae96" />
      {/* tap here: waves over the screen */}
      <g fill="none" stroke="#ffc72c" strokeWidth="5" strokeLinecap="round" className={p.waves}>
        <path d="M188 70 a26 26 0 0 1 0 40" />
        <path d="M200 58 a42 42 0 0 1 0 64" />
      </g>
      {/* a card going into the slot (nothing shows above it), then the slot */}
      {card && (
        <>
          <clipPath id="rcl-reader-slot">
            <rect x="0" y="216" width="230" height="84" />
          </clipPath>
          <g clipPath="url(#rcl-reader-slot)">
            <g className={p.card}>
              <rect x="74" y="208" width="72" height="74" rx="7" fill="#ed1c24" stroke="#14110c" strokeWidth="3" />
              <rect x="86" y="242" width="18" height="14" rx="3" fill="#ffc72c" stroke="#14110c" strokeWidth="2" />
              <rect x="112" y="268" width="26" height="5" rx="2.5" fill="#f3ecd9" opacity="0.8" />
            </g>
          </g>
        </>
      )}
      <rect x="64" y="210" width="92" height="10" rx="5" fill="#14110c" />
    </svg>
  );
}
