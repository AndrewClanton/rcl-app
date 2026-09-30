"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/help/InfoTip";
import type { DayReport } from "@/lib/data/reports";
import type { DayDrillData, DrillStaff } from "@/lib/data/day-drill";
import { TIP_METHODS, cents, isSharedLogin, isTipMethod, presence, splitTips, tipKind, type Kinds, type Presence, type SplitResult, type TipMethod } from "@/lib/tip-split";
import { setDrillParams } from "./drill-nav";
import { Section, money, shortDay, time } from "./drill-ui";
import { clearTipPayout, recordTipPayout } from "./tip-actions";

// Reports -> Day -> Tips: every tip and who rang it, who was on, and the
// day's tips split three ways side by side (even, by hours, by who rang
// it), with a box per person to leave someone out (owners, say). A manager
// records the split that was paid out.

// Who's left out of (or let into) the split, remembered on this device:
// employee id -> ticked. Anyone not in it is in by default, except someone
// whose only link to the day is an old shift left open.
const KEY = "rcl.tip-split.v1";
const NONE: Record<string, boolean> = {};
let cached: Record<string, boolean> | null = null;
const listeners = new Set<() => void>();

function readChoices(): Record<string, boolean> {
  if (cached) return cached;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    cached = saved && typeof saved === "object" ? saved : {};
  } catch {
    cached = {};
  }
  return cached!;
}

function saveChoices(next: Record<string, boolean>) {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: remembered for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const HOUR = 3_600_000;
const ZERO: Kinds = { card: 0, cash: 0 };

function dollars(c: number) {
  return money(c / 100);
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0].toLowerCase();
}

export default function TipsDrill({
  r,
  drill,
  canRecord,
  orderHref,
  splitParam,
}: {
  r: DayReport;
  drill: DayDrillData;
  canRecord: boolean;
  orderHref: (n: number) => string;
  splitParam: string | null;
}) {
  const choices = useSyncExternalStore(subscribe, readChoices, () => NONE);
  const method: TipMethod = isTipMethod(splitParam) ? splitParam : "even";
  const over = Date.parse(drill.window.now) >= Date.parse(drill.window.end);

  const staffById = new Map(drill.staff.map((s) => [s.id, s]));
  const nameOf = (id: string | null) => (id ? (staffById.get(id)?.name ?? "Someone") : "No cashier");
  const shared = (id: string | null) => {
    const s = id ? staffById.get(id) : undefined;
    return !!s && isSharedLogin(s);
  };

  const completed = r.orders.filter((o) => o.status === "completed");
  const tipped = completed.filter((o) => o.tip > 0).sort((a, b) => a.at.localeCompare(b.at));
  const pres = presence(
    drill.window,
    drill.shifts,
    completed.map((o) => ({ employeeId: o.cashierId, at: o.at })),
  );
  const byStart = (a: Presence, b: Presence) => (a.from ?? Infinity) - (b.from ?? Infinity) || nameOf(a.employeeId).localeCompare(nameOf(b.employeeId));
  // The people who could share the tips: a shift that day, or a sale rung.
  const people = [...pres.values()].filter((p) => staffById.has(p.employeeId) && !shared(p.employeeId)).sort(byStart);
  const sharedRows = [...pres.values()].filter((p) => shared(p.employeeId)).sort(byStart);

  const pool: Kinds = { ...ZERO };
  const rang = new Map<string, Kinds>();
  for (const o of tipped) {
    const kind = tipKind(o);
    pool[kind] += cents(o.tip);
    if (o.cashierId) {
      const k = rang.get(o.cashierId) ?? { ...ZERO };
      k[kind] += cents(o.tip);
      rang.set(o.cashierId, k);
    }
  }
  const poolTotal = pool.card + pool.cash;

  const isIn = (p: Presence) => choices[p.employeeId] ?? !p.staleOnly;
  const inSplit = people.filter(isIn).map((p) => ({ id: p.employeeId, name: nameOf(p.employeeId), hours: p.hours, rang: rang.get(p.employeeId) ?? ZERO }));
  const splits = Object.fromEntries(TIP_METHODS.map((m) => [m.key, splitTips(m.key, inSplit, pool)])) as Record<TipMethod, SplitResult>;
  const chosen = splits[method];
  const chosenLabel = TIP_METHODS.find((m) => m.key === method)!.label;
  const share = (m: TipMethod, id: string) => splits[m].shares.find((s) => s.id === id);

  // Why tips go unassigned under "by who rang it".
  const sharedTips = tipped.filter((o) => shared(o.cashierId)).reduce((s, o) => s + cents(o.tip), 0);
  const noCashierTips = tipped.filter((o) => !o.cashierId).reduce((s, o) => s + cents(o.tip), 0);
  const leftOutTips = people.filter((p) => !isIn(p)).reduce((s, p) => s + (rang.get(p.employeeId)?.card ?? 0) + (rang.get(p.employeeId)?.cash ?? 0), 0);

  const setMethod = (m: TipMethod) => setDrillParams({ split: m === "even" ? null : m });
  const toggle = (p: Presence) => saveChoices({ ...readChoices(), [p.employeeId]: !isIn(p) });

  return (
    <>
      <Section
        title={`${money(r.tips)} in tips`}
        subtitle={
          tipped.length === 0
            ? "No tips this day."
            : `On ${tipped.length} sale${tipped.length === 1 ? "" : "s"}. ${
                pool.cash > 0 ? `${dollars(pool.card)} on cards, ${dollars(pool.cash)} in cash.` : "All on cards: only card tips and tips entered on the register are here (cash in the tip jar isn't recorded)."
              }`
        }
      >
        <PaidOut r={r} drill={drill} canRecord={canRecord} />
      </Section>

      {poolTotal > 0 && (
        <Section
          title={
            <>
              Split the tips
              <InfoTip topic="tip-split" />
            </>
          }
          subtitle="Tick who's in. Your ticks are remembered on this device."
        >
          <div role="radiogroup" aria-label="How to split" className="mb-2 flex max-w-full overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 [scrollbar-width:none]">
            {TIP_METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={m.key === method}
                onClick={() => setMethod(m.key)}
                className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${m.key === method ? "bg-[var(--foreground)] font-semibold text-[var(--background)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-xs text-[var(--muted)]">
            {TIP_METHODS.find((m) => m.key === method)!.about}
            {method !== "rang" ? " Tips rung under the shared register login are in the pool." : " Tips rung under the shared register login, or by someone left out, stay unassigned."}
          </p>

          <table className="w-full table-fixed text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-[var(--muted)]">
                <th className="w-[40%] pb-1.5 text-left font-medium">Who</th>
                {TIP_METHODS.map((m) => (
                  <th key={m.key} className={`pb-1.5 text-right font-medium ${m.key === method ? "text-[var(--foreground)]" : ""}`}>
                    <button type="button" onClick={() => setMethod(m.key)} className="underline-offset-2 hover:underline">
                      {m.key === "even" ? "Even" : m.key === "hours" ? "Hours" : "Rang it"}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const on = isIn(p);
                const s = staffById.get(p.employeeId)!;
                return (
                  <tr key={p.employeeId} className={`border-t border-[var(--border)] align-top ${on ? "" : "text-[var(--muted)]"}`}>
                    <td className="py-2 pr-1">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--foreground)]" checked={on} onChange={() => toggle(p)} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{s.name}</span>
                          <Badges p={p} s={s} over={over} />
                        </span>
                      </label>
                    </td>
                    {TIP_METHODS.map((m) => {
                      const sh = share(m.key, p.employeeId);
                      return (
                        <td key={m.key} className={`py-2 text-right ${m.key === method ? "bg-[var(--surface-hover)] font-semibold" : ""}`}>
                          <span className="block px-1">{on && sh ? dollars(sh.total) : "—"}</span>
                          {m.key === "hours" && <span className="block px-1 text-xs font-normal text-[var(--muted)]">{p.hours.toFixed(1)} h</span>}
                          {m.key === "rang" && !on && (rang.get(p.employeeId)?.card ?? 0) + (rang.get(p.employeeId)?.cash ?? 0) > 0 && (
                            <span className="block px-1 text-xs font-normal">rang {dollars((rang.get(p.employeeId)?.card ?? 0) + (rang.get(p.employeeId)?.cash ?? 0))}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {TIP_METHODS.some((m) => splits[m.key].unassigned.card + splits[m.key].unassigned.cash > 0) && (
                <tr className="border-t border-[var(--border)] text-[var(--muted)]">
                  <td className="py-2 pr-1">
                    Unassigned
                    <span className="block text-xs">nobody gets it</span>
                  </td>
                  {TIP_METHODS.map((m) => {
                    const u = splits[m.key].unassigned.card + splits[m.key].unassigned.cash;
                    return (
                      <td key={m.key} className={`py-2 text-right ${m.key === method ? "bg-[var(--surface-hover)] font-semibold" : ""}`}>
                        <span className="block px-1">{u > 0 ? dollars(u) : "—"}</span>
                      </td>
                    );
                  })}
                </tr>
              )}
              <tr className="border-t-2 border-[var(--foreground)] font-semibold">
                <td className="py-2">Total</td>
                {TIP_METHODS.map((m) => (
                  <td key={m.key} className={`py-2 text-right ${m.key === method ? "bg-[var(--surface-hover)]" : ""}`}>
                    <span className="block px-1">{dollars(poolTotal)}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <div className="mt-3 space-y-1 text-xs text-[var(--muted)]">
            {TIP_METHODS.flatMap((m) =>
              splits[m.key].leftovers.map((l) => (
                <p key={`${m.key}-${l.kind}`}>
                  {m.label}: {l.cents}¢ left over from rounding{pool.cash > 0 ? ` (${l.kind} tips)` : ""} went to {l.to}, the first in the list, so it adds up to the cent.
                </p>
              )),
            )}
            {inSplit.length === 0 && <p>Nobody is ticked, so nobody gets anything yet.</p>}
            {method === "hours" && inSplit.length > 0 && inSplit.every((p) => p.hours <= 0) && <p>Nobody ticked has any hours counted, so the tips stay unassigned.</p>}
            {method === "rang" && (sharedTips > 0 || noCashierTips > 0 || leftOutTips > 0) && (
              <p>
                Unassigned under &ldquo;by who rang it&rdquo;:{" "}
                {[
                  sharedTips > 0 ? `${dollars(sharedTips)} rung under the shared register login` : "",
                  noCashierTips > 0 ? `${dollars(noCashierTips)} with no cashier` : "",
                  leftOutTips > 0 ? `${dollars(leftOutTips)} rung by people left out` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
            )}
            {Object.keys(choices).length > 0 && (
              <p>
                <button type="button" className="underline underline-offset-2 hover:text-[var(--foreground)]" onClick={() => saveChoices({})}>
                  Forget my ticks
                </button>{" "}
                (everyone who worked is in again).
              </p>
            )}
          </div>

          {pool.cash > 0 && chosen.shares.length > 0 && (
            <div className="mt-3 rounded-lg bg-[var(--surface-hover)] p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-[var(--muted)]">{chosenLabel}: card and cash tips, each split on its own</div>
              <ul className="space-y-0.5 tabular-nums">
                {chosen.shares.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span className="truncate">{s.name}</span>
                    <span>
                      card {dollars(s.card)} · cash {dollars(s.cash)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <HoursNotes people={people.filter((p) => p.notes.length > 0)} nameOf={nameOf} />

          <RecordPayout r={r} drill={drill} canRecord={canRecord} method={method} chosen={chosen} unassigned={chosen.unassigned.card + chosen.unassigned.cash} />
        </Section>
      )}

      <Section title="Who was on" subtitle="Shifts from the register's shift bar, and the sales each person rang (a dot is a sale with a tip).">
        <WhoWasOn drill={drill} rows={[...people, ...sharedRows]} nameOf={nameOf} shared={shared} orders={completed} />
      </Section>

      {tipped.length > 0 && (
        <Section title="Every tip" subtitle="The cashier is who was picked on the register for the sale.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1.5 pr-2 font-medium">Time</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Tip</th>
                  <th className="pb-1.5 pr-2 font-medium">Cashier</th>
                  <th className="hidden pb-1.5 pr-2 font-medium sm:table-cell">Paid</th>
                  <th className="pb-1.5 text-right font-medium">Order</th>
                </tr>
              </thead>
              <tbody>
                {tipped.map((o) => (
                  <tr key={o.id} className="border-t border-[var(--border)] align-top">
                    <td className="whitespace-nowrap py-1.5 pr-2">{time(o.at)}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold">{money(o.tip)}</td>
                    <td className="py-1.5 pr-2">
                      {o.cashierId ? nameOf(o.cashierId) : o.source === "pos" ? "No cashier" : "Website"}
                      {shared(o.cashierId) && <span className="block text-xs text-[var(--muted)]">shared login</span>}
                      <span className="block text-xs capitalize text-[var(--muted)] sm:hidden">{tipKind(o) === "cash" ? "cash" : (o.method ?? "card")}</span>
                    </td>
                    <td className="hidden py-1.5 pr-2 capitalize sm:table-cell">{tipKind(o) === "cash" ? "cash" : (o.method ?? "card")}</td>
                    <td className="py-1.5 text-right">
                      <Link href={orderHref(o.orderNumber)} className="underline-offset-2 hover:underline">
                        #{o.orderNumber}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <WorthFixing drill={drill} people={people} tipped={tipped} completed={completed} staffById={staffById} shared={shared} />
    </>
  );
}

// ---------- small flags beside a name ----------

function Badges({ p, s, over }: { p: Presence; s: DrillStaff; over: boolean }) {
  const flags: string[] = [];
  if (s.role === "owner") flags.push("owner");
  if (!p.onShift) flags.push("no shift");
  if (p.carried) flags.push("shift from an earlier day");
  if (p.neverEnded) flags.push(over || p.carried ? "shift never ended" : "on shift now");
  if (p.staleOnly) flags.push("no sales today");
  if (!flags.length) return null;
  return <span className="block text-xs font-normal leading-tight text-[var(--muted)]">{flags.join(" · ")}</span>;
}

function HoursNotes({ people, nameOf }: { people: Presence[]; nameOf: (id: string) => string }) {
  if (!people.length) return null;
  return (
    <details className="mt-3 text-xs text-[var(--muted)]">
      <summary className="cursor-pointer">How the hours were counted</summary>
      <ul className="mt-1 space-y-1">
        {people.map((p) => (
          <li key={p.employeeId}>
            <span className="font-medium text-[var(--foreground)]">{nameOf(p.employeeId)}</span> ({p.hours.toFixed(1)} h): {p.notes.join(" ")}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- paid out, and recording it ----------

function PaidOut({ r, drill, canRecord }: { r: DayReport; drill: DayDrillData; canRecord: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = drill.payout;
  if (!drill.payoutsReady) return <p className="text-sm text-[var(--muted)]">Recording payouts needs a database update first.</p>;
  if (!p) return r.tips > 0 ? <p className="text-sm text-[var(--muted)]">Not recorded as paid out yet.</p> : null;
  const label = TIP_METHODS.find((m) => m.key === p.method)?.label ?? p.method;
  const off = Math.round((r.tips - p.total) * 100);

  return (
    <div className="rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm">
      <div className="font-semibold text-[var(--success-text)]">Paid out ({label})</div>
      <p className="mt-0.5">{p.rows.map((x) => `${x.name} ${money(x.amount)}`).join(" · ")}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {money(p.total)} recorded by {p.recordedBy ?? "someone"}, {shortDay(p.recordedAt)} at {time(p.recordedAt)}.
        {off > 0 && ` ${money(off / 100)} of the day's tips isn't in it.`}
        {off < 0 && ` That's ${money(-off / 100)} more than the day's tips now (a refund since?).`}
      </p>
      {p.note && <p className="mt-1 text-xs italic">{p.note}</p>}
      {canRecord && (
        <button
          type="button"
          disabled={busy}
          className="mt-2 text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
          onClick={async () => {
            if (!window.confirm("Take this payout record off? The tips stay; only the record of who was paid is removed.")) return;
            setBusy(true);
            setError(null);
            try {
              const res = await clearTipPayout(r.date);
              if (!res.ok) setError(res.error);
              else router.refresh();
            } catch {
              setError("Couldn't remove it. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove this record
        </button>
      )}
      {error && <p className="mt-1 text-xs text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}

function RecordPayout({ r, drill, canRecord, method, chosen, unassigned }: { r: DayReport; drill: DayDrillData; canRecord: boolean; method: TipMethod; chosen: SplitResult; unassigned: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = TIP_METHODS.find((m) => m.key === method)!.label;
  const paying = chosen.shares.filter((s) => s.total > 0);

  if (!drill.payoutsReady) return null;
  if (!canRecord) return <p className="mt-3 text-xs text-[var(--muted)]">A manager records the payout.</p>;

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      {!open ? (
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={paying.length === 0} onClick={() => setOpen(true)}>
          {drill.payout ? "Record again (replaces it)" : "Record tip payout"} · {label}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-semibold">
            Record {label.toLowerCase()} for {new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}?
          </div>
          <ul className="text-sm tabular-nums">
            {paying.map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span>{s.name}</span>
                <span className="font-semibold">{dollars(s.total)}</span>
              </li>
            ))}
            {unassigned > 0 && (
              <li className="flex justify-between gap-3 text-[var(--muted)]">
                <span>Not given to anyone</span>
                <span>{dollars(unassigned)}</span>
              </li>
            )}
          </ul>
          <input className="input !py-1.5 text-sm" placeholder="Note (optional), e.g. paid in cash from the drawer" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1 sm:flex-none"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await recordTipPayout({
                    date: r.date,
                    method,
                    rows: paying.map((s) => ({ employeeId: s.id, amount: s.total / 100 })),
                    note: [note.trim(), unassigned > 0 ? `${dollars(unassigned)} not given to anyone.` : ""].filter(Boolean).join(" "),
                  });
                  if (!res.ok) setError(res.error);
                  else {
                    setOpen(false);
                    setNote("");
                    router.refresh();
                  }
                } catch {
                  setError("Couldn't save it. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-secondary flex-1 sm:flex-none" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- who was on: a bar per person ----------

function hourLabel(ms: number) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" }).format(new Date(ms)));
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
}

function WhoWasOn({
  drill,
  rows,
  nameOf,
  shared,
  orders,
}: {
  drill: DayDrillData;
  rows: Presence[];
  nameOf: (id: string) => string;
  shared: (id: string | null) => boolean;
  orders: DayReport["orders"];
}) {
  const start = Date.parse(drill.window.start);
  const end = Date.parse(drill.window.end);
  const now = Date.parse(drill.window.now);
  const over = now >= end;
  // An open shift runs to now (or the day's end, once it's over).
  const openTo = over ? end : now;

  const lines = rows.map((p) => ({
    p,
    bars: drill.shifts
      .filter((s) => s.employeeId === p.employeeId)
      .map((s) => {
        const began = Date.parse(s.startedAt);
        const to = Math.min(s.endedAt ? Date.parse(s.endedAt) : openTo, openTo);
        return { id: s.id, from: Math.max(began, start), to, carried: began < start, open: !s.endedAt, began };
      })
      .filter((b) => b.to > b.from),
    sales: orders.filter((o) => o.cashierId === p.employeeId).map((o) => ({ id: o.id, t: Date.parse(o.at), tipped: o.tip > 0 })),
  }));

  const times = lines.flatMap((l) => [...l.bars.flatMap((b) => [b.from, b.to]), ...l.sales.map((s) => s.t)]);
  if (!times.length) return <p className="text-sm text-[var(--muted)]">No shifts or sales this day.</p>;
  const lo = Math.floor(Math.min(...times) / HOUR) * HOUR;
  const hi = Math.max(lo + HOUR, Math.ceil(Math.max(...times) / HOUR) * HOUR);
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const span = (hi - lo) / HOUR;
  const step = span > 16 ? 3 : span > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step * HOUR) ticks.push(t);

  return (
    <div>
      <ul className="space-y-1.5">
        {lines.map(({ p, bars, sales }) => {
          const isShared = shared(p.employeeId);
          const sub = isShared
            ? "shared login"
            : !p.onShift || !bars.length
              ? `${p.onShift ? "shift" : "no shift"} · ${p.sales} sale${p.sales === 1 ? "" : "s"}`
              : [
                  bars.some((b) => b.carried) ? shortDay(Math.min(...bars.map((b) => b.began))).replace(",", "") : time(Math.min(...bars.map((b) => b.from))),
                  bars.some((b) => b.open) ? (over || bars.some((b) => b.carried && b.open) ? "never ended" : "still on") : time(Math.max(...bars.map((b) => b.to))),
                ].join("–") + (p.sales ? ` · ${p.sales} sale${p.sales === 1 ? "" : "s"}` : "");
          return (
            <li key={p.employeeId} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-xs leading-tight sm:w-36">
                <div className="truncate font-medium">{nameOf(p.employeeId)}</div>
                <div className={p.neverEnded && !isShared ? "text-[var(--warn-text)]" : "text-[var(--muted)]"}>{sub}</div>
              </div>
              <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-md bg-[var(--surface-hover)]">
                {bars.map((b) => (
                  <div
                    key={b.id}
                    className={`absolute top-2.5 h-3 ${b.open ? "rpt-bar border border-dashed border-[var(--foreground)]" : "rpt-bar-mid"} ${b.carried ? "rounded-r-sm" : "rounded-sm"}`}
                    style={{ left: `${pct(b.from)}%`, width: `${Math.max(0.6, pct(b.to) - pct(b.from))}%` }}
                    title={`${time(b.began)} (${shortDay(b.began)}) to ${b.open ? "never ended" : time(b.to)}`}
                  />
                ))}
                {sales.map((s) =>
                  s.tipped ? (
                    <span key={s.id} className="absolute top-0.5 h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--foreground)]" style={{ left: `${pct(s.t)}%` }} />
                  ) : (
                    <span key={s.id} className="absolute bottom-0.5 h-2 w-px bg-[var(--muted)]" style={{ left: `${pct(s.t)}%` }} />
                  ),
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center gap-2">
        <div className="w-24 shrink-0 sm:w-36" />
        <div className="relative h-4 min-w-0 flex-1">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={`absolute text-[10px] text-[var(--muted)] ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${pct(t)}%` }}
            >
              {hourLabel(t)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="rpt-bar-mid inline-block h-2.5 w-5 rounded-sm" /> shift
        </span>
        <span className="flex items-center gap-1">
          <span className="rpt-bar inline-block h-2.5 w-5 rounded-sm border border-dashed border-[var(--foreground)]" /> never ended
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-px bg-[var(--muted)]" /> sale
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--foreground)]" /> sale with a tip
        </span>
      </p>
    </div>
  );
}

// ---------- what to fix so the split is right ----------

function WorthFixing({
  drill,
  people,
  tipped,
  completed,
  staffById,
  shared,
}: {
  drill: DayDrillData;
  people: Presence[];
  tipped: DayReport["orders"];
  completed: DayReport["orders"];
  staffById: Map<string, DrillStaff>;
  shared: (id: string | null) => boolean;
}) {
  const start = Date.parse(drill.window.start);
  const over = Date.parse(drill.window.now) >= Date.parse(drill.window.end);
  const name = (id: string) => staffById.get(id)?.name ?? "Someone";
  const fixes: string[] = [];

  for (const s of drill.shifts) {
    const began = Date.parse(s.startedAt);
    if (!s.endedAt) {
      if (began < start || over) fixes.push(`${name(s.employeeId)}'s shift from ${shortDay(began)} at ${time(began)} was never ended.`);
    } else {
      const ended = Date.parse(s.endedAt);
      const hours = (ended - began) / HOUR;
      if (hours > 16) fixes.push(`${name(s.employeeId)}'s shift ran ${Math.round(hours)} hours (${shortDay(began)} ${time(began)} to ${shortDay(ended)} ${time(ended)}); it was probably left open.`);
    }
  }
  for (const p of people) {
    if (!p.onShift && p.sales) fixes.push(`${name(p.employeeId)} rang ${p.sales} sale${p.sales === 1 ? "" : "s"} without starting a shift.`);
    else if (p.onShift && p.stretched) fixes.push(`${name(p.employeeId)} rang sales outside their shift.`);
  }
  const sharedIds = [...new Set(completed.filter((o) => shared(o.cashierId)).map((o) => o.cashierId!))];
  for (const id of sharedIds) {
    const sales = completed.filter((o) => o.cashierId === id);
    const tips = tipped.filter((o) => o.cashierId === id).reduce((s, o) => s + o.tip, 0);
    fixes.push(`${sales.length} sale${sales.length === 1 ? " was" : "s were"} rung under the shared “${name(id)}” login${tips > 0 ? ` (${money(tips)} in tips)` : ""}, so nobody is credited. Pick a name on the register.`);
  }
  const noCashier = completed.filter((o) => o.source === "pos" && !o.cashierId);
  if (noCashier.length) fixes.push(`${noCashier.length} register sale${noCashier.length === 1 ? " has" : "s have"} no cashier picked.`);

  // The same first name on two active staff records ("Gage", "Gage Williams").
  const onToday = new Set(people.map((p) => p.employeeId));
  const groups = new Map<string, DrillStaff[]>();
  for (const s of drill.staff) {
    if (!s.active || isSharedLogin(s)) continue;
    const k = firstName(s.name);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const g of groups.values()) {
    if (g.length < 2 || !g.some((s) => onToday.has(s.id))) continue;
    fixes.push(`${g.map((s) => `“${s.name}”`).join(" and ")} are ${g.length} staff records. If they're one person, their shifts and sales are split between them (Back office → Staff).`);
  }

  if (!fixes.length) return null;
  return (
    <section className="notice notice-warn">
      <h3 className="mb-1 font-semibold">Worth fixing</h3>
      <ul className="list-disc space-y-1 pl-5">
        {fixes.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </section>
  );
}
