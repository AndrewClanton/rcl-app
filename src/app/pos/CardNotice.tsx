"use client";

import { useEffect, useRef, useState } from "react";
import { pointsText, type CardNotice } from "@/lib/card-match";
import { giveCardSalePoints, giveUndoneSalePoints, undoCardMatch, unlinkSaleCard } from "./card-link-actions";
import MemberFinder from "./MemberFinder";

type ActionResult = { ok: true; message: string; notice?: CardNotice } | { ok: false; error: string };
type Button = { label: string; onClick: () => void; danger?: boolean };

// What a card sale's card did (lib/member-cards.ts): points found by the
// card, a card newly linked to the member on the sale, or a shared card
// that needs a name. Its buttons work for 2 minutes, on this register only;
// then it goes away (a manager can still undo a card match on the member's
// page in Back office). Undo asks first, and says which kind: someone else
// paid with the member's card (the card stays theirs), or it isn't their
// card at all (it comes off their account). After an Undo, the points can go
// to the right member.
export default function CardNoticeBanner({ notice, onClose }: { notice: CardNotice; onClose: () => void }) {
  const [current, setCurrent] = useState<CardNotice>(notice);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false); // Undo's "which kind?" step
  const [finding, setFinding] = useState(false); // picking a member after an Undo
  const [expired, setExpired] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Its buttons stop working when the token runs out (or after 20 seconds
  // with none); an answer stays up a little while.
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => closeRef.current(), done.ok ? 8000 : 15000);
      return () => clearTimeout(t);
    }
    const ms = current.token && current.ttlMs ? current.ttlMs : 20_000;
    const t = setTimeout(() => setExpired(true), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [current, done]);
  // Never while a button's answer is on its way: it's shown when it lands.
  useEffect(() => {
    if (expired && !busy && !done) closeRef.current();
  }, [expired, busy, done]);

  async function run(action: () => Promise<ActionResult>) {
    setBusy(true);
    setAsking(false);
    setFinding(false);
    const r = await action().catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));
    setBusy(false);
    if (r.ok && r.notice) {
      setExpired(false);
      setCurrent(r.notice);
      return;
    }
    setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
  }

  const token = current.token;
  const canAct = !!token && !busy && !done;

  let text: string;
  let buttons: Button[] = [];
  switch (current.kind) {
    case "matched": {
      const who = current.firstName;
      const why =
        current.how === "card"
          ? `Nobody was attached, and this card is linked to ${who}'s account.`
          : current.how === "picked"
            ? "This card is on more than one account; you picked who's paying."
            : "Given after an undo.";
      text = `${current.points > 0 ? `${pointsText(current.points)} to ${who}` : `${who}'s account`} · ${current.label}. ${why}`;
      if (token && !asking) buttons = [{ label: "Undo", danger: true, onClick: () => setAsking(true) }];
      if (token && asking) {
        text = `Take the ${pointsText(current.points)} back from ${who}?`;
        const id = current.orderId;
        buttons =
          current.how === "card"
            ? [
                { label: `Someone else paid (card stays on ${who}'s account)`, danger: true, onClick: () => run(() => undoCardMatch(id, token, false)) },
                { label: `Not ${who}'s card (unlink it)`, danger: true, onClick: () => run(() => undoCardMatch(id, token, true)) },
                { label: "Keep it", onClick: () => setAsking(false) },
              ]
            : [
                { label: "Take them back", danger: true, onClick: () => run(() => undoCardMatch(id, token, false)) },
                { label: "Keep it", onClick: () => setAsking(false) },
              ];
      }
      break;
    }
    case "undone": {
      const who = current.firstName;
      text = `${pointsText(current.taken)} taken back from ${who}${current.unlinked ? `, and ${current.label} is off ${who}'s account` : ""}. Give the ${pointsText(current.points)} to whoever paid?`;
      if (token) {
        const id = current.orderId;
        buttons = current.candidates.map((c) => ({ label: c.name, onClick: () => run(() => giveUndoneSalePoints(id, c.id, token)) }));
        buttons.push({ label: "Find a member", onClick: () => setFinding(true) });
        buttons.push({ label: "No one", onClick: onClose });
      }
      break;
    }
    case "linked":
      text = `${current.label} is now linked to ${current.firstName}'s account (it paid for ${current.firstName} on another day too). When it pays and nobody's attached, ${current.firstName} still gets the points.`;
      if (token) buttons = [{ label: "Don't link", onClick: () => run(() => unlinkSaleCard(current.orderId, token)) }];
      break;
    case "choose":
      text = `${current.label} is linked to ${current.candidates.length} accounts, so nobody got the ${pointsText(current.points)} yet. Who's paying?`;
      if (token) {
        const id = current.orderId;
        buttons = current.candidates.map((c) => ({ label: c.name, onClick: () => run(() => giveCardSalePoints(id, c.id, token)) }));
        buttons.push({ label: "Nobody", onClick: onClose });
      }
      break;
  }

  return (
    <div className={`notice ${done && !done.ok ? "notice-warn" : "notice-success"} p-2.5 text-xs`} role="status">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">
          💳 Order #{current.orderNumber}: {done ? done.text : text}
        </span>
        <button className="shrink-0 px-1 text-sm leading-none" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {!done && buttons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {buttons.map((b, i) => (
            <button key={`${i}-${b.label}`} className="chip !px-3 !py-1" style={b.danger ? { color: "var(--danger-text)" } : undefined} disabled={!canAct} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {finding && token && current.kind === "undone" && (
        <MemberFinder onPick={(m) => run(() => giveUndoneSalePoints(current.orderId, m.id, token))} onClose={() => setFinding(false)} />
      )}
    </div>
  );
}
