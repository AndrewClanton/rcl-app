"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IMPACT_CATEGORIES, type ImpactCategory } from "@/lib/org-invoices";
import { addActivity, deleteActivity, saveEin, type ActivityFields } from "./actions";

// Back office → Community impact: logging a one-off activity, the EIN, and
// the CSV download.

function Problem({ error }: { error: string | null }) {
  return error ? (
    <p className="notice notice-warn text-sm" role="alert">
      {error}
    </p>
  ) : null;
}

export function ActivityForm({ orgs, today }: { orgs: { id: string; name: string; category: ImpactCategory }[]; today: string }) {
  const router = useRouter();
  const blank: ActivityFields = { date: today, orgId: "", category: "seniors", description: "", people: "", value: "" };
  const [f, setF] = useState<ActivityFields>(blank);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof ActivityFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAdded(false);
    const v = e.target.value;
    // Picking an organization picks its category too.
    const org = k === "orgId" ? orgs.find((o) => o.id === v) : null;
    setF({ ...f, [k]: v, ...(org ? { category: org.category } : {}) });
  };
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="font-semibold">What happened</span>
        <input className="input mt-1 w-full" value={f.description} onChange={set("description")} maxLength={200} placeholder="Free screening for assisted living residents" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-sm">
          <span className="font-semibold">Date</span>
          <input className="input mt-1 w-full" type="date" value={f.date} onChange={set("date")} />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">People</span>
          <input className="input mt-1 w-full" inputMode="numeric" value={f.people} onChange={set("people")} placeholder="22" />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Value ($)</span>
          <input className="input mt-1 w-full" inputMode="decimal" value={f.value} onChange={set("value")} placeholder="176" />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Served</span>
          <select className="input mt-1 w-full" value={f.category} onChange={set("category")}>
            {IMPACT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Organization</span>
          <select className="input mt-1 w-full" value={f.orgId} onChange={set("orgId")}>
            <option value="">None</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Problem error={error} />
      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await addActivity(f);
              if (!r.ok) return setError(r.error);
              setF({ ...blank, date: f.date });
              setAdded(true);
              router.refresh();
            })
          }
        >
          Log it
        </button>
        {added && <span className="text-sm text-[var(--muted)]">Logged.</span>}
      </div>
    </div>
  );
}

export function RemoveActivity({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="text-sm underline print:hidden"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove "${label}"?`)) return;
        start(async () => {
          const r = await deleteActivity(id);
          if (!r.ok) alert(r.error);
          router.refresh();
        });
      }}
    >
      Remove
    </button>
  );
}

export function EinForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [ein, setEin] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-40"
          value={ein}
          onChange={(e) => {
            setSaved(false);
            setEin(e.target.value);
          }}
          placeholder="12-3456789"
          maxLength={10}
        />
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await saveEin(ein);
              if (!r.ok) return setError(r.error);
              setSaved(true);
              router.refresh();
            })
          }
        >
          Save
        </button>
        {saved && <span className="text-sm text-[var(--muted)]">Saved.</span>}
      </div>
      <Problem error={error} />
    </div>
  );
}

// Quoted when needed, and text a spreadsheet would run as a formula starts
// with an apostrophe.
function cell(raw: string) {
  const s = /^[=+\-@]/.test(raw) && !/^-?\d/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CsvButton({ rows, name }: { rows: string[][]; name: string }) {
  return (
    <button
      className="btn-secondary print:hidden"
      onClick={() => {
        const blob = new Blob(["﻿", rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }}
    >
      Download CSV
    </button>
  );
}
