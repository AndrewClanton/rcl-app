"use client";

import { useState } from "react";
import { TIP_PERCENTS, type CardOnFileAsk as Ask } from "@/lib/registerChannel";
import k from "./kiosk.module.css";

// "Charge $12.34 to your Visa ending 4242?": the guest's yes before the
// register charges their card on file (lib/registerChannel.ts CardOnFileAsk).
// With a tip question first when the register asks for tips, with the card
// reader's own choices. Their answer goes back to the register; the question
// stays up ("One moment…") until the register says it's done.

function money(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

export default function CardOnFileAsk({ ask, onAnswer }: { ask: Ask; onAnswer: (yes: boolean, tipCents: number) => void }) {
  const tipping = !!ask.tipBaseCents;
  // null: not picked yet (only while tipping).
  const [tip, setTip] = useState<number | null>(tipping ? null : 0);
  const [custom, setCustom] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const card = ask.label.replace("••", "ending ");
  const customCents = custom !== null && /^\d{1,4}$/.test(custom) ? Number(custom) * 100 : null;

  function answer(yes: boolean) {
    if (sent) return;
    setSent(true);
    onAnswer(yes, yes ? (tip ?? 0) : 0);
  }

  if (tip === null) {
    return (
      <div className={k.setup} role="dialog" aria-modal="true" aria-labelledby="cof-title">
        <div className={k.setupCard}>
          <div>
            <div className={k.eyebrow}>Paying with your card on file</div>
            <h1 id="cof-title" className={k.setupTitle}>
              Add a tip?
            </h1>
            <p className={k.big} style={{ marginTop: 8 }}>
              Your total: {money(ask.amountCents)}
            </p>
          </div>
          {custom === null ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {TIP_PERCENTS.map((p) => (
                <button key={p} type="button" className={k.cta} onClick={() => setTip(Math.round(((ask.tipBaseCents ?? 0) * p) / 100))}>
                  {p}%
                  <span style={{ display: "block", fontSize: "0.6em" }}>{money(Math.round(((ask.tipBaseCents ?? 0) * p) / 100))}</span>
                </button>
              ))}
              <button type="button" className={k.ghost} onClick={() => setCustom("")}>
                Other amount
              </button>
              <button type="button" className={k.ghost} style={{ gridColumn: "span 2" }} onClick={() => setTip(0)}>
                No tip
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label className={k.big}>
                Tip in dollars
                <input
                  autoFocus
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  style={{ display: "block", width: "100%", marginTop: 8, fontSize: 32, padding: "8px 12px", borderRadius: 12 }}
                />
              </label>
              <button type="button" className={k.cta} disabled={customCents === null} onClick={() => customCents !== null && setTip(customCents)}>
                Add {customCents !== null ? money(customCents) : "tip"}
              </button>
              <button type="button" className={k.ghost} onClick={() => setCustom(null)}>
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={k.setup} role="dialog" aria-modal="true" aria-labelledby="cof-title">
      <div className={k.setupCard}>
        <div>
          <div className={k.eyebrow}>Card on file</div>
          <h1 id="cof-title" className={k.setupTitle}>
            Charge {money(ask.amountCents + tip)} to your {card}?
          </h1>
          {tipping && (
            <p className={k.big} style={{ marginTop: 8 }}>
              {tip > 0 ? `${money(ask.amountCents)} plus a ${money(tip)} tip.` : "No tip."}{" "}
              {tipping && !sent && (
                <button type="button" className={k.ghost} style={{ minHeight: 40, padding: "0 12px" }} onClick={() => setTip(null)}>
                  Change tip
                </button>
              )}
            </p>
          )}
        </div>
        <button type="button" className={k.cta} disabled={sent} onClick={() => answer(true)}>
          {sent ? "One moment…" : "Yes, charge it"}
        </button>
        <button type="button" className={k.ghost} disabled={sent} onClick={() => answer(false)}>
          No
        </button>
        <p className={k.setupFoot}>Not your card? Tap No and tell us.</p>
      </div>
    </div>
  );
}
