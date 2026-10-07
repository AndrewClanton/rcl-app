"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LINE_KINDS, money, type PaidMethod, type PayStatus } from "@/lib/org-invoices";
import { addInvoiceLine, deleteInvoiceLine, emailInvoice, includeMonthlyFee, markInvoice, payByCardLink, type LineFields } from "./invoice-actions";

// Back office → Organizations → invoices: the forms and buttons
// (lib/org-invoices.ts).

function Problem({ error }: { error: string | null }) {
  return error ? (
    <p className="notice notice-warn text-sm" role="alert">
      {error}
    </p>
  ) : null;
}

export function AddInvoiceLine({ orgId, defaultDate }: { orgId: string; defaultDate: string }) {
  const router = useRouter();
  const blank: LineFields = { date: defaultDate, kind: "event", description: "", fullValue: "", charged: "", people: "" };
  const [f, setF] = useState<LineFields>(blank);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof LineFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAdded(false);
    setF({ ...f, [k]: e.target.value });
  };
  const full = Number(f.fullValue.replace(/[$,]/g, ""));
  const charged = Number(f.charged.replace(/[$,]/g, ""));
  const covered = f.fullValue && f.charged && Number.isFinite(full) && Number.isFinite(charged) ? Math.max(0, full - charged) : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-semibold">Date</span>
          <input className="input mt-1 w-full" type="date" value={f.date} onChange={set("date")} />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">What</span>
          <select className="input mt-1 w-full" value={f.kind} onChange={set("kind")}>
            {LINE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-semibold">People (optional)</span>
          <input className="input mt-1 w-full" inputMode="numeric" value={f.people} onChange={set("people")} placeholder="For Community impact" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-semibold">Description</span>
        <input className="input mt-1 w-full" value={f.description} onChange={set("description")} maxLength={200} placeholder="Private screening: The Goonies" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-semibold">Full value ($)</span>
          <input className="input mt-1 w-full" inputMode="decimal" value={f.fullValue} onChange={set("fullValue")} placeholder="400" />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Amount charged ($)</span>
          <input className="input mt-1 w-full" inputMode="decimal" value={f.charged} onChange={set("charged")} placeholder="50" />
        </label>
        <div className="text-sm">
          <span className="font-semibold">Covered by the Royale Cinema Project</span>
          <div className="mt-2 text-lg font-semibold tabular-nums">{covered === null ? "–" : money(covered)}</div>
        </div>
      </div>
      <Problem error={error} />
      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await addInvoiceLine(orgId, f);
              if (!r.ok) return setError(r.error);
              setF({ ...blank, date: f.date, kind: f.kind });
              setAdded(true);
              router.refresh();
            })
          }
        >
          Add to invoice
        </button>
        {added && <span className="text-sm text-[var(--muted)]">Added.</span>}
      </div>
    </div>
  );
}

export function RemoveLine({ orgId, lineId, label }: { orgId: string; lineId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="text-sm underline print:hidden"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove "${label}" from the invoice?`)) return;
        start(async () => {
          const r = await deleteInvoiceLine(orgId, lineId);
          if (!r.ok) alert(r.error);
          router.refresh();
        });
      }}
    >
      Remove
    </button>
  );
}

export function InvoiceStatus({ orgId, month, status, method }: { orgId: string; month: string; status: PayStatus; method: PaidMethod | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mark = (s: PayStatus, m: PaidMethod | null) =>
    start(async () => {
      setError(null);
      const r = await markInvoice(orgId, month, s, m);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  const btn = (on: boolean) => (on ? "btn-primary !py-1.5 text-sm" : "btn-secondary !py-1.5 text-sm");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className={btn(status === "unpaid")} disabled={pending} onClick={() => mark("unpaid", null)}>
          Unpaid
        </button>
        {(["cash", "check", "card"] as PaidMethod[]).map((m) => (
          <button key={m} className={btn(status === "paid" && method === m)} disabled={pending} onClick={() => mark("paid", m)}>
            Paid by {m}
          </button>
        ))}
        <button
          className={btn(status === "waived")}
          disabled={pending}
          onClick={() => {
            if (confirm("Waive this month? Nothing will be owed; the invoice becomes a receipt.")) mark("waived", null);
          }}
        >
          Waived
        </button>
      </div>
      <Problem error={error} />
    </div>
  );
}

export function FeeToggle({ orgId, month, include, fee }: { orgId: string; month: string; include: boolean; fee: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={include}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await includeMonthlyFee(orgId, month, e.target.checked);
            if (!r.ok) alert(r.error);
            router.refresh();
          })
        }
      />
      Put the {money(fee)} monthly fee on this invoice
    </label>
  );
}

export function SendInvoice({ orgId, month, contactEmail, receipt }: { orgId: string; month: string; contactEmail: string | null; receipt: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(contactEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const what = receipt ? "receipt" : "invoice";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Where to send it" />
        <button
          className="btn-primary"
          disabled={pending || !email.trim()}
          onClick={() => {
            if (!confirm(`Email the ${what} to ${email.trim()} now?`)) return;
            start(async () => {
              setError(null);
              setSent(null);
              const r = await emailInvoice(orgId, month, email);
              if (!r.ok) return setError(r.error);
              setSent(r.to);
              router.refresh();
            });
          }}
        >
          Email the {what}
        </button>
      </div>
      {sent && <p className="text-sm text-[var(--muted)]">Sent to {sent}.</p>}
      <Problem error={error} />
    </div>
  );
}

export function PayLink({ orgId, month, url, current, due }: { orgId: string; month: string; url: string | null; current: boolean; due: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {url && current ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={url} target="_blank" rel="noreferrer" className="min-w-0 break-all underline">
            {url}
          </a>
          <button
            className="btn-secondary !py-1 text-sm"
            onClick={() => {
              navigator.clipboard?.writeText(url).then(() => setCopied(true), () => null);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          className="btn-secondary"
          disabled={pending || due < 0.5}
          onClick={() => {
            if (!confirm(`Make a Stripe pay-by-card link for ${money(due)}?${url ? " The old link (for a different amount) stops working." : ""}`)) return;
            start(async () => {
              setError(null);
              const r = await payByCardLink(orgId, month);
              if (!r.ok) return setError(r.error);
              router.refresh();
            });
          }}
        >
          {url ? `Make a new pay-by-card link for ${money(due)}` : `Make a pay-by-card link for ${money(due)}`}
        </button>
      )}
      <Problem error={error} />
    </div>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button className="btn-secondary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
