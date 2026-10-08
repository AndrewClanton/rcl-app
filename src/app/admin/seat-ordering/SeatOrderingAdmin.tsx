"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/help/InfoTip";
import { SPOT_KINDS, SPOT_KIND_LABEL, clockLabel, type OrderSpot, type SeatSettings, type SpotKind } from "@/lib/seat-ordering";
import { addSpot, rotateSpotCode, saveSeatSettings, updateSpot } from "./actions";

export default function SeatOrderingAdmin({ settings, state, spots }: { settings: SeatSettings; state: string; spots: OrderSpot[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [opens, setOpens] = useState(settings.opens);
  const [closes, setCloses] = useState(settings.closes);
  const [kind, setKind] = useState<SpotKind>("booth");
  const [name, setName] = useState("");
  const [rotating, setRotating] = useState<OrderSpot | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okText?: string) {
    setError(null);
    setSaved(null);
    start(async () => {
      const r = await fn().catch(() => ({ ok: false as const, error: "Couldn't reach the website. Try again." }));
      if (!r.ok) setError(r.error);
      else {
        if (okText) setSaved(okText);
        router.refresh();
      }
    });
  }

  const active = spots.filter((s) => s.active);

  return (
    <div className="space-y-8">
      {error && (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm font-bold" role="status" style={{ color: "var(--success-text)" }}>
          {saved}
        </p>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Seat ordering: {settings.enabled ? "on" : "off"}</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Right now: {state}. While it&apos;s on, the register can switch it off too: Staff → Seat ordering.
            </p>
          </div>
          <button
            className={settings.enabled ? "btn-secondary min-h-11" : "btn-primary min-h-11"}
            disabled={pending}
            onClick={() => run(() => saveSeatSettings({ enabled: !settings.enabled, opens, closes }), settings.enabled ? "Switched off." : "Switched on.")}
          >
            {settings.enabled ? "Switch off" : "Switch on"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="label-xs block">On from</span>
            <input type="time" className="input !w-36" value={opens} onChange={(e) => setOpens(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="label-xs block">Until</span>
            <input type="time" className="input !w-36" value={closes} onChange={(e) => setCloses(e.target.value)} />
          </label>
          <button
            className="btn-secondary min-h-11"
            disabled={pending || (opens === settings.opens && closes === settings.closes)}
            onClick={() => run(() => saveSeatSettings({ enabled: settings.enabled, opens, closes }), "Hours saved.")}
          >
            Save hours
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Off by itself outside {clockLabel(settings.opens)} to {clockLabel(settings.closes)} and all day Sunday, when we&apos;re closed. A time after midnight counts as the
          same night.
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display flex items-center text-xl">
            Spots and QR cards
            <InfoTip topic="seat-ordering-cards" />
          </h2>
          <Link href="/admin/seat-ordering/cards" className="btn-primary min-h-11 inline-flex items-center">
            Print all {active.length} cards
          </Link>
        </div>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "var(--muted)" }}>
                <th className="px-3 py-2 font-semibold">Spot</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">Dark screen</th>
                <th className="px-3 py-2 font-semibold">On</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {spots.map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: "var(--border)", opacity: s.active ? 1 : 0.55 }}>
                  <td className="px-3 py-2">
                    <input
                      className="input !w-48"
                      defaultValue={s.name}
                      aria-label={`Name of ${s.name}`}
                      onBlur={(e) => e.target.value.trim() !== s.name && run(() => updateSpot(s.id, { name: e.target.value }), "Renamed.")}
                    />
                  </td>
                  <td className="px-3 py-2">{SPOT_KIND_LABEL[s.kind]}</td>
                  <td className="px-3 py-2">
                    <input type="checkbox" className="h-5 w-5" checked={s.dark} disabled={pending} onChange={(e) => run(() => updateSpot(s.id, { dark: e.target.checked }))} aria-label={`Dark screen for ${s.name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" className="h-5 w-5" checked={s.active} disabled={pending} onChange={(e) => run(() => updateSpot(s.id, { active: e.target.checked }))} aria-label={`${s.name} takes orders`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      <a className="chip min-h-9 inline-flex items-center !text-sm" href={`/order/${s.code}`} target="_blank" rel="noreferrer">
                        Open
                      </a>
                      <Link className="chip min-h-9 inline-flex items-center !text-sm" href={`/admin/seat-ordering/cards?id=${s.id}`}>
                        Print card
                      </Link>
                      <button className="chip min-h-9 !text-sm" disabled={pending} onClick={() => setRotating(s)}>
                        New code
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await addSpot({ kind, name });
              if (r.ok) setName("");
              return r;
            }, "Added. Print its card.");
          }}
        >
          <label className="text-sm">
            <span className="label-xs block">Kind</span>
            <select className="input !w-36" value={kind} onChange={(e) => setKind(e.target.value as SpotKind)}>
              {SPOT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SPOT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="label-xs block">Name</span>
            <input className="input !w-56" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={kind === "cinema" ? "Cinema · Row F" : kind === "table" ? "Table 5" : "Booth 9"} />
          </label>
          <button className="btn-secondary min-h-11" disabled={pending || !name.trim()}>
            Add spot
          </button>
        </form>
      </section>

      {rotating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="New code">
          <div className="card w-full max-w-md">
            <h2 className="font-display text-xl">New code for {rotating.name}?</h2>
            <p className="mt-2 text-sm">The card at {rotating.name} stops working right away, along with any copy of it. Print the new card and swap it in.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary min-h-11" onClick={() => setRotating(null)}>
                Cancel
              </button>
              <button
                className="btn-primary min-h-11"
                onClick={() => {
                  const s = rotating;
                  setRotating(null);
                  run(() => rotateSpotCode(s.id), `New code for ${s.name}. Print its card.`);
                }}
              >
                Make a new code
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
