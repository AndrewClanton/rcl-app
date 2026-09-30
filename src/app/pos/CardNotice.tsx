"use client";

import { useEffect, useRef, useState } from "react";
import { nameList, pointsText, type CardNotice } from "@/lib/card-match";
import { giveCardSalePoints, linkSaleCard, undoCardMatch, unlinkSaleCard } from "./card-link-actions";

// What a card sale's card did (lib/member-cards.ts): points found by the
// card, a card newly linked to the member on the sale, a shared card that
// needs a name, or a card that's linked only if the cashier says so. Its
// buttons work for 2 minutes, on this register only; then it goes away (a
// manager can still undo a card match on the member's page in Back office).
export default function CardNoticeBanner({ notice, onClose }: { notice: CardNotice; onClose: () => void }) {
  const [current, setCurrent] = useState<CardNotice>(notice);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Gone when its buttons stop working (or after 20 seconds with none), and
  // a little after an answer.
  useEffect(() => {
    const ms = done ? (done.ok ? 8000 : 15000) : current.token && current.ttlMs ? current.ttlMs : 20_000;
    const t = setTimeout(() => closeRef.current(), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [current, done]);

  async function run(action: () => Promise<{ ok: true; message: string; notice?: CardNotice } | { ok: false; error: string }>) {
    setBusy(true);
    const r = await action().catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));
    setBusy(false);
    if (r.ok && r.notice) {
      setCurrent(r.notice);
      return;
    }
    setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
  }

  const token = current.token;
  const canAct = !!token && !busy && !done;

  let text: string;
  let buttons: { label: string; onClick: () => void; danger?: boolean }[] = [];
  switch (current.kind) {
    case "matched":
      text =
        current.points > 0
          ? `${pointsText(current.points)} to ${current.firstName} · ${current.label}. Nobody was attached, and this card is linked to ${current.firstName}'s account.`
          : `${current.firstName}'s account · ${current.label}. Nobody was attached, and this card is linked to ${current.firstName}'s account.`;
      if (token) buttons = [{ label: `Undo: not ${current.firstName}'s card`, danger: true, onClick: () => run(() => undoCardMatch(current.orderId, token)) }];
      break;
    case "linked":
      text = `${current.label} is now linked to ${current.firstName}'s account. When it pays and nobody's attached, ${current.firstName} still gets the points.`;
      if (token) buttons = [{ label: "Don't link", onClick: () => run(() => unlinkSaleCard(current.orderId, token)) }];
      break;
    case "self":
      text = `${current.firstName}'s account is a staff login, so ${current.label} wasn't linked on its own. Link it?`;
      if (token) buttons = [{ label: "Link it", onClick: () => run(() => linkSaleCard(current.orderId, token)) }];
      break;
    case "shared":
      text = `${current.label} is already linked to ${nameList(current.ownerNames) || "another account"}, so it wasn't linked to ${current.firstName}. Link it to ${current.firstName} too? Then a sale on it with nobody attached asks who's paying.`;
      if (token) buttons = [{ label: `Link to ${current.firstName} too`, onClick: () => run(() => linkSaleCard(current.orderId, token)) }];
      break;
    case "choose":
      text = `${current.label} is linked to ${current.candidates.length} accounts, so nobody got the ${pointsText(current.points)} yet. Who's paying?`;
      if (token) {
        buttons = current.candidates.map((c) => ({ label: c.name, onClick: () => run(() => giveCardSalePoints(current.orderId, c.id, token)) }));
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
          {buttons.map((b) => (
            <button key={b.label} className="chip !px-3 !py-1" style={b.danger ? { color: "var(--danger-text)" } : undefined} disabled={!canAct} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
