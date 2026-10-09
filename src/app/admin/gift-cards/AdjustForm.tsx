"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustGiftCard } from "./actions";

// Add to or take off a card's balance, with a reason (kept in its history).
export default function AdjustForm({ cardId, balance }: { cardId: string; balance: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dir, setDir] = useState<"add" | "take">("take");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = Math.round((parseFloat(amount) || 0) * 100) / 100;

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        startTransition(async () => {
          const r = await adjustGiftCard(cardId, dir === "add" ? n : -n, reason);
          if (r.ok) {
            setMsg({ ok: true, text: `Done. It has $${r.balance.toFixed(2)} now.` });
            setAmount("");
            setReason("");
            router.refresh();
          } else setMsg({ ok: false, text: r.error });
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          <button type="button" className={`chip ${dir === "take" ? "chip-selected" : ""}`} onClick={() => setDir("take")}>
            Take off
          </button>
          <button type="button" className={`chip ${dir === "add" ? "chip-selected" : ""}`} onClick={() => setDir("add")}>
            Add
          </button>
        </div>
        <label className="block w-28">
          <div className="label-xs">Amount</div>
          <input className="input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="block min-w-[200px] flex-1">
          <div className="label-xs">Why</div>
          <input className="input" maxLength={200} placeholder="e.g. Paid part of an order in cash by mistake" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="btn-primary" disabled={pending || !(n > 0) || reason.trim().length < 3}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Now ${balance.toFixed(2)}
        {n > 0 ? `; after this, $${Math.max(0, balance + (dir === "add" ? n : -n)).toFixed(2)}` : ""}. Your name, the amount and the reason go in the card&apos;s history.
      </p>
      {msg && <p className={`text-sm ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
    </form>
  );
}
