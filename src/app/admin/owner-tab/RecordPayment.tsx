"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordOwnerPayment } from "./actions";

// "Record a payment": what an owner paid against a month's statement, and
// how. It settles that month (part payments add up). It's money in on
// Reports the day it's recorded.

export interface PayableOwner {
  id: string;
  firstName: string;
  months: { month: string; label: string; balance: number; running: boolean }[];
}

const METHODS = [
  { key: "card", label: "Card" },
  { key: "cash", label: "Cash" },
  { key: "check", label: "Check" },
  { key: "transfer", label: "Transfer" },
] as const;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function RecordPayment({ owners, today }: { owners: PayableOwner[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const withBalance = owners.filter((o) => o.months.length > 0);
  const [ownerId, setOwnerId] = useState(withBalance[0]?.id ?? "");
  const owner = withBalance.find((o) => o.id === ownerId) ?? null;
  // The oldest month still owed comes first: that's the statement to settle.
  const [month, setMonth] = useState(owner?.months[0]?.month ?? "");
  const picked = owner?.months.find((m) => m.month === month) ?? owner?.months[0] ?? null;
  const [amount, setAmount] = useState(picked ? picked.balance.toFixed(2) : "");
  const [method, setMethod] = useState<string>("");
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function pickOwner(id: string) {
    setOwnerId(id);
    const o = withBalance.find((x) => x.id === id);
    setMonth(o?.months[0]?.month ?? "");
    setAmount(o?.months[0] ? o.months[0].balance.toFixed(2) : "");
  }

  function pickMonth(m: string) {
    setMonth(m);
    const b = owner?.months.find((x) => x.month === m);
    setAmount(b ? b.balance.toFixed(2) : "");
  }

  const value = Math.round(parseFloat(amount) * 100) / 100;
  const ready = !!owner && !!picked && value > 0 && !!method && !!paidOn && !pending;

  function save() {
    if (!ready || !owner || !picked) return;
    setMsg(null);
    start(async () => {
      const out = await recordOwnerPayment({ ownerId: owner.id, month: picked.month, amount: value, method, paidOn, note }).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      setMsg(out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error });
      if (out.ok) {
        setMethod("");
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <section id="pay" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
      <h2 className="text-base font-semibold">Record a payment</h2>
      <p className="mt-1 text-[var(--muted)]">What an owner paid against a month&apos;s tab. Part payments add up; the month is settled once it&apos;s all paid.</p>
      {withBalance.length === 0 ? (
        <p className="mt-3">Nothing is owed on any owner tab right now.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--muted)]">
            Whose tab
            <select className="input mt-1 min-h-11 w-full" value={owner?.id ?? ""} onChange={(e) => pickOwner(e.target.value)}>
              {withBalance.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.firstName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            The month it pays
            <select className="input mt-1 min-h-11 w-full" value={picked?.month ?? ""} onChange={(e) => pickMonth(e.target.value)}>
              {(owner?.months ?? []).map((m) => (
                <option key={m.month} value={m.month}>
                  {m.label}: {money(m.balance)} {m.running ? "so far" : "owed"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Amount
            <input className="input mt-1 min-h-11 w-full" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Date paid
            <input type="date" className="input mt-1 min-h-11 w-full" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <div className="text-xs text-[var(--muted)] sm:col-span-2">
            How they paid
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METHODS.map((m) => (
                <button key={m.key} type="button" className={`chip min-h-11 !text-sm font-semibold ${method === m.key ? "chip-selected" : ""}`} onClick={() => setMethod(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs text-[var(--muted)] sm:col-span-2">
            Note (optional)
            <input className="input mt-1 min-h-11 w-full" maxLength={300} placeholder="Check number, which account, anything to remember" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <button className="btn-primary min-h-11 w-full sm:w-auto" disabled={!ready} onClick={save}>
              {pending ? "Saving..." : picked && value > 0 ? `Record ${money(value)} for ${picked.label}` : "Record the payment"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
    </section>
  );
}
