"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MyLinkedCard } from "@/lib/data/member-account";
import { dateShort } from "../format";
import { removeMyCard, setCardLinking } from "../../actions";

const HOW: Record<string, string> = { register: "at the register", online: "buying tickets online", plus: "from your Insiders+ billing" };

// "Cards linked to your account" (lib/member-cards.ts): each with Remove,
// and their own switch for linking cards at all.
export function LinkedCards({ cards, linkCards }: { cards: MyLinkedCard[]; linkCards: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState(linkCards);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const r = await removeMyCard(id).catch(() => ({ ok: false as const, error: "Couldn't remove it. Try again." }));
    setBusy(null);
    if (!r.ok) setError(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] text-[var(--muted)]">
        Pay with one of these cards and you get your points, even if you forget to sign in or nobody puts your account on the order. We keep only the
        card type, its last four digits, and a code from Stripe (our card processor) that recognizes the same card again. Never the card number.
      </p>

      {cards.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {on ? "No cards yet. Pay by card at the register with your account on the order, and that card is linked for next time." : "No cards linked."}
        </p>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-[var(--border)]">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <strong>{c.label}</strong>
                <span className="block text-sm text-[var(--muted)]">
                  Linked {dateShort(c.linkedAt)} {HOW[c.source] ?? ""}
                  {c.lastUsedAt ? ` · last used ${dateShort(c.lastUsedAt)}` : ""}
                  {c.wallet ? " · a phone or watch counts as its own card" : ""}
                </span>
              </span>
              <button className="btn-secondary px-3 py-1.5 text-sm" disabled={busy !== null} onClick={() => remove(c.id)}>
                {busy === c.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

      <label className="flex cursor-pointer items-start gap-3 border-t-2 border-dashed border-[var(--border)] pt-4">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 accent-[var(--accent)]"
          checked={on}
          disabled={busy !== null}
          onChange={async (e) => {
            const next = e.target.checked;
            setOn(next);
            setBusy("switch");
            const r = await setCardLinking(next).catch(() => ({ ok: false as const, error: "" }));
            setBusy(null);
            if (!r.ok) setOn(!next);
            else router.refresh();
          }}
        />
        <span className="text-sm">
          <strong>Link cards I pay with</strong>
          <span className="block text-[var(--muted)]">
            When it&apos;s off, no new cards are linked and the ones above stop earning points on their own. Points still come when your account is on
            the order.
          </span>
        </span>
      </label>
    </div>
  );
}
