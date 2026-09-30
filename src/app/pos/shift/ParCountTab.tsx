"use client";

import { useEffect, useMemo, useState } from "react";
import ConfirmModal from "@/components/ConfirmModal";
import { useOpsApi } from "./api";
import {
  COUNT_STEP_LABEL,
  PAR_SIZES,
  PAR_UNITS,
  autoStep,
  buyQty,
  parLabel,
  qtyLabel,
  qtyUnit,
  singularUnit,
  stepFor,
  unitFor,
  type OnShift,
  type ParItem,
} from "@/lib/ops/shared";

// The par sheet: count what's on hand in each item's own unit. Anything
// under par lands on the shopping list. A count in progress is kept on this
// tablet, so stepping away (or a reload) doesn't lose it. Bottles, kegs,
// jugs and the like count in quarters (an open bottle ¾ full is ¾).

const DRAFT_KEY = "rcl.par.draft";
const readDraft = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const writeDraft = (d: Record<string, number>) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
};

// "7:52 PM", or "Mon 7:52 PM" when it wasn't today.
const outTime = (iso: string) => {
  const opts = { timeZone: "America/Chicago" } as const;
  const sameDay = new Date(iso).toLocaleDateString("en-US", opts) === new Date().toLocaleDateString("en-US", opts);
  return new Date(iso).toLocaleString("en-US", { ...opts, ...(sameDay ? {} : { weekday: "short" as const }), hour: "numeric", minute: "2-digit" });
};

const round2 = (n: number) => Math.round(n * 100) / 100;
// + and − land on the item's step (2¾ counted by wholes goes to 3, then 4).
const stepUp = (v: number | undefined, step: number) => (v === undefined ? step : round2((Math.floor(v / step + 1e-9) + 1) * step));
const stepDown = (v: number | undefined, step: number) => (v === undefined ? 0 : Math.max(0, round2((Math.ceil(v / step - 1e-9) - 1) * step)));
// The ¼ ½ ¾ buttons set the part of one that's open: 2 → 2¾. Tapping the
// lit one takes it off again (2¾ → 2).
const withPart = (v: number | undefined, part: number) => {
  const whole = v === undefined ? 0 : Math.floor(v + 1e-9);
  const current = v === undefined ? null : round2(v - whole);
  return current === part ? whole : whole + part;
};
const PARTS = [
  { v: 0.25, label: "¼" },
  { v: 0.5, label: "½" },
  { v: 0.75, label: "¾" },
];

export default function ParCountTab({ me, closing, onSubmitted }: { me: OnShift | null; closing: boolean; onSubmitted: () => void }) {
  const api = useOpsApi();
  const [items, setItems] = useState<ParItem[] | null>(null);
  const [last, setLast] = useState<Record<string, { qty: number; at: string }>>({});
  // Par lines reported "Ran out" and not bought yet, with when.
  const [outs, setOuts] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [area, setArea] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.getParSheet()
      .then((d) => {
        setItems(d.items);
        setLast(d.last);
        setOuts(d.outs ?? {});
        setCounts(readDraft());
        setArea((a) => a || d.items.find((i) => i.active)?.area || "");
      })
      .catch(() => setError("Couldn't load the par sheet. Check the connection."));

  useEffect(() => {
    let alive = true;
    api.getParSheet()
      .then((d) => {
        if (!alive) return;
        setItems(d.items);
        setLast(d.last);
        setOuts(d.outs ?? {});
        setCounts(readDraft());
        setArea(d.items.find((i) => i.active)?.area ?? "");
      })
      .catch(() => alive && setError("Couldn't load the par sheet. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);

  const active = useMemo(() => (items ?? []).filter((i) => i.active), [items]);
  const areas = useMemo(() => [...new Set(active.map((i) => i.area))], [active]);
  const counted = active.filter((i) => counts[i.id] !== undefined).length;
  const below = active.filter((i) => counts[i.id] !== undefined && i.par_qty !== null && counts[i.id] < i.par_qty).length;

  function set(id: string, v: number | undefined) {
    setCounts((prev) => {
      const next = { ...prev };
      if (v === undefined) delete next[id];
      else next[id] = Math.max(0, Math.round(v * 100) / 100);
      writeDraft(next);
      return next;
    });
  }

  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    const lines = active.filter((i) => counts[i.id] !== undefined).map((i) => ({ itemId: i.id, qty: counts[i.id] }));
    const r = await api.submitParCount(lines, me?.employeeId ?? null, me?.shiftId ?? null).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't save the count. Check the connection; your numbers are still here.");
    writeDraft({});
    setCounts({});
    onSubmitted();
  }

  if (editing) return <EditParItems items={items ?? []} me={me} area={area} onDone={() => { setEditing(false); load(); }} />;
  if (!items) return <p style={{ color: error ? "var(--danger-text)" : "var(--muted)" }}>{error ?? "Loading…"}</p>;

  const inArea = active.filter((i) => i.area === area);
  const sections = [...new Set(inArea.map((i) => i.section ?? ""))];

  return (
    <div className="space-y-5 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">{closing ? "Closing par count" : "Par count"}</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Count what&apos;s on hand, in the unit shown. Tap <strong>= par</strong> when it&apos;s fully stocked. Bottles, kegs and jugs count to the quarter: tap{" "}
            <strong>¼ ½ ¾</strong> for the open one.
          </p>
        </div>
        <button className="btn-secondary !px-4 !py-2 text-sm" onClick={() => setEditing(true)}>
          Edit the list
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {areas.map((a) => {
          const list = active.filter((i) => i.area === a);
          const n = list.filter((i) => counts[i.id] !== undefined).length;
          return (
            <button
              key={a}
              className={`rounded-xl border-2 px-4 py-2.5 text-left text-sm font-bold ${a === area ? "text-[var(--background)]" : ""}`}
              style={{ borderColor: "var(--foreground)", background: a === area ? "var(--foreground)" : "var(--surface)" }}
              onClick={() => setArea(a)}
            >
              {a}
              <span className="block text-xs font-normal opacity-80">
                {n} of {list.length} counted
              </span>
            </button>
          );
        })}
      </div>

      {sections.map((sec) => (
        <section key={sec || "none"}>
          {sec && <div className="eyebrow mb-2">{sec}</div>}
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            {inArea
              .filter((i) => (i.section ?? "") === sec)
              .map((i, idx) => {
                const v = counts[i.id];
                const low = v !== undefined && i.par_qty !== null && v < i.par_qty;
                const need = low ? round2(i.par_qty! - v!) : 0;
                const step = stepFor(i);
                const lit = v === undefined ? null : round2(v - Math.floor(v + 1e-9));
                const prev = last[i.id];
                const one = i.unit ? singularUnit(i.unit) : "one";
                return (
                  <div
                    key={i.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${idx ? "border-t" : ""}`}
                    style={{ borderColor: "var(--border)", background: low ? "var(--warn-bg)" : undefined }}
                  >
                    <div className="min-w-[10rem] flex-1">
                      <div className="font-bold">{i.name}</div>
                      <div className="text-xs" style={{ color: "var(--muted)" }}>
                        Par {parLabel(i)}
                        {i.unit_size ? ` · ${i.unit_size}` : ""}
                        {i.source ? ` · ${i.source}` : ""}
                      </div>
                      {prev && (
                        <div className="text-xs" style={{ color: "var(--muted)" }}>
                          Last count {qtyUnit(prev.qty, i.unit)}, {outTime(prev.at)}
                        </div>
                      )}
                      {outs[i.id] && (
                        <div className="text-xs font-bold" style={{ color: "var(--danger-text)" }}>
                          Reported out at {outTime(outs[i.id])}
                        </div>
                      )}
                      {low && (
                        <div className="text-xs font-bold" style={{ color: "var(--warn-text)" }}>
                          {Number.isInteger(need) ? `Below par: get ${qtyUnit(need, i.unit)}` : `Below par by ${qtyUnit(need, i.unit)}: get ${qtyUnit(buyQty(need), i.unit)}`}
                        </div>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {i.par_qty !== null && (
                        <button className="chip h-12 !px-3 !text-sm" onClick={() => set(i.id, i.par_qty!)} aria-label={`${i.name}: at par, ${parLabel(i)}`}>
                          = par
                        </button>
                      )}
                      {step === 0.25 && (
                        <div className="flex overflow-hidden rounded-xl border-2" style={{ borderColor: "var(--border)" }} role="group" aria-label={`${i.name}: part of an open ${one}`}>
                          {PARTS.map((p, n) => (
                            <button
                              key={p.v}
                              className={`h-11 w-11 text-lg font-bold ${n ? "border-l-2" : ""}`}
                              style={{
                                borderColor: "var(--border)",
                                background: lit === p.v ? "var(--foreground)" : "var(--surface)",
                                color: lit === p.v ? "var(--background)" : undefined,
                              }}
                              aria-pressed={lit === p.v}
                              aria-label={`${p.label} of a ${one}`}
                              onClick={() => set(i.id, withPart(v, p.v))}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        className="h-12 w-12 rounded-xl border-2 text-2xl font-bold"
                        style={{ borderColor: "var(--foreground)" }}
                        onClick={() => set(i.id, stepDown(v, step))}
                        aria-label={`${qtyLabel(step)} fewer: ${i.name}`}
                      >
                        −
                      </button>
                      <div className="w-20 text-center" aria-live="polite">
                        <div className="font-display text-2xl leading-none tabular-nums">{v === undefined ? <span style={{ color: "var(--muted)" }}>—</span> : qtyLabel(v)}</div>
                        {i.unit && (
                          <div className="mt-1 truncate text-xs leading-tight" style={{ color: "var(--muted)" }}>
                            {unitFor(i.unit, v ?? null)}
                          </div>
                        )}
                      </div>
                      <button
                        className="h-12 w-12 rounded-xl border-2 text-2xl font-bold"
                        style={{ borderColor: "var(--foreground)" }}
                        onClick={() => set(i.id, stepUp(v, step))}
                        aria-label={`${qtyLabel(step)} more: ${i.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t-2 px-4 py-3" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <div className="text-sm">
            <strong>
              {counted} of {active.length}
            </strong>{" "}
            counted · <strong style={{ color: below ? "var(--warn-text)" : undefined }}>{below}</strong> below par
            {error && <div style={{ color: "var(--danger-text)" }}>{error}</div>}
          </div>
          <div className="ml-auto flex gap-2">
            {counted > 0 && (
              <button
                className="btn-secondary !px-4 !py-3"
                onClick={() => {
                  writeDraft({});
                  setCounts({});
                }}
              >
                Clear
              </button>
            )}
            <button className="btn-primary !px-6 !py-3" disabled={busy || counted === 0} onClick={() => (counted < active.length ? setConfirming(true) : submit())}>
              {busy ? "Saving…" : "Save count"}
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmModal
          title={`${active.length - counted} items not counted`}
          description="Save anyway? It adds to anything else counted today. Items nobody has counted today stay off the shopping list, under Not counted today."
          confirmLabel="Save count"
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// ---------- editing the list ----------

function EditParItems({ items, me, area, onDone }: { items: ParItem[]; me: OnShift | null; area: string; onDone: () => void }) {
  const api = useOpsApi();
  const [list, setList] = useState(items);
  const [form, setForm] = useState<Partial<ParItem> | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const areas = [...new Set(list.map((i) => i.area))];
  const [sheet, setSheet] = useState(area || areas[0] || "");

  const refresh = async () => {
    const d = await api.getParSheet().catch(() => null);
    if (d) setList(d.items);
  };

  const inSheet = list.filter((i) => i.area === sheet && i.active);
  const removed = list.filter((i) => !i.active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Edit the par sheet</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Changes save right away and are logged{me ? ` as ${me.name}` : ""}. Removed items can be put back.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary !px-4 !py-2 text-sm" onClick={() => setForm({ area: sheet, name: "", par_qty: 1 })}>
            Add an item
          </button>
          <button className="btn-secondary !px-4 !py-2 text-sm" onClick={onDone}>
            Done editing
          </button>
        </div>
      </div>

      {form && (
        <ItemForm
          initial={form}
          all={list}
          onCancel={() => setForm(null)}
          onSave={async (v) => {
            const r = await api.saveParItem(v, me?.employeeId ?? null).catch(() => null);
            if (!r || !r.ok) return r && !r.ok ? r.error : "Couldn't save. Check the connection.";
            setForm(null);
            await refresh();
            return null;
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {areas.map((a) => (
          <button key={a} className={`chip !px-4 !py-2 !text-sm ${a === sheet ? "chip-selected" : ""}`} onClick={() => setSheet(a)}>
            {a}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        {inSheet.map((i, idx) => (
          <div key={i.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${idx ? "border-t" : ""}`} style={{ borderColor: "var(--border)" }}>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{i.name}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {i.section ?? "No section"} · Par {parLabel(i)}
                {i.unit_size ? ` · ${i.unit_size}` : ""} · {stepLabel(i)} · {i.source ?? "No store"}
              </div>
            </div>
            <button className="chip !px-3 !py-1.5" onClick={() => setForm(i)}>
              Edit
            </button>
            <button
              className="chip !px-3 !py-1.5"
              onClick={async () => {
                await api.setParItemActive(i.id, false, me?.employeeId ?? null).catch(() => null);
                refresh();
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {removed.length > 0 && (
        <div>
          <button className="text-sm font-bold underline" onClick={() => setShowRemoved((s) => !s)}>
            {showRemoved ? "Hide" : "Show"} removed items ({removed.length})
          </button>
          {showRemoved && (
            <div className="mt-2 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              {removed.map((i, idx) => (
                <div key={i.id} className={`flex items-center gap-3 px-4 py-2.5 opacity-70 ${idx ? "border-t" : ""}`} style={{ borderColor: "var(--border)" }}>
                  <div className="flex-1">
                    {i.name} <span className="text-xs">· {i.area}</span>
                  </div>
                  <button
                    className="chip !px-3 !py-1.5"
                    onClick={async () => {
                      await api.setParItemActive(i.id, true, me?.employeeId ?? null).catch(() => null);
                      refresh();
                    }}
                  >
                    Put back
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// "Counts in quarters", or "Counts in quarters (automatic)".
function stepLabel(i: Pick<ParItem, "par_qty" | "unit" | "count_step">): string {
  const s = stepFor(i);
  const what = s === 0.25 ? "quarters" : s === 0.5 ? "halves" : "whole units";
  return `Counts in ${what}${i.count_step === null ? " (automatic)" : ""}`;
}

type SaveInput = {
  id?: string;
  area: string;
  section: string | null;
  name: string;
  par_qty: number | null;
  unit: string | null;
  unit_size: string | null;
  count_step: number | null;
  source: string | null;
};

const STEP_CHOICES: { v: number | null; label: string }[] = [
  { v: 1, label: COUNT_STEP_LABEL["1"] },
  { v: 0.5, label: COUNT_STEP_LABEL["0.5"] },
  { v: 0.25, label: COUNT_STEP_LABEL["0.25"] },
  { v: null, label: "Automatic" },
];

function ItemForm({
  initial,
  all,
  onSave,
  onCancel,
}: {
  initial: Partial<ParItem>;
  all: ParItem[];
  onSave: (v: SaveInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [area, setArea] = useState(initial.area ?? "");
  const [section, setSection] = useState(initial.section ?? "");
  const [par, setPar] = useState(initial.par_qty === null || initial.par_qty === undefined ? "" : String(initial.par_qty));
  const [unit, setUnit] = useState(initial.unit ?? "");
  const [size, setSize] = useState(initial.unit_size ?? "");
  const [step, setStep] = useState<number | null>(initial.count_step ?? null);
  const [source, setSource] = useState(initial.source ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const parNumber = (s: string) => (s.trim() === "" ? null : Number(s.replace("½", ".5").replace("¼", ".25").replace("¾", ".75")));
  // What Automatic works out to for this unit and par, shown on the button.
  const parNow = parNumber(par);
  const auto = autoStep(unit.trim() || null, parNow !== null && Number.isFinite(parNow) ? parNow : null);
  const autoWhat = auto === 0.25 ? "quarters" : "whole";
  // Suggested units: the tidy ones, plus any in use without a size in brackets.
  const units = uniq([...PAR_UNITS, ...all.map((i) => (i.unit && !/[()]/.test(i.unit) ? i.unit : null))]);
  const sizes = uniq([...PAR_SIZES, ...all.map((i) => i.unit_size)]);

  return (
    <form
      className="card grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const parQty = parNumber(par);
        if (parQty !== null && !Number.isFinite(parQty)) return setError("Par should be a number, like 1 or 0.5.");
        // A size typed into the unit ("bags (12.5 lb)") goes in Size.
        let u = unit.trim();
        let sz = size.trim();
        const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(u);
        if (m && !sz) {
          u = m[1];
          sz = m[2].trim();
        }
        // A count means nothing without what it's counted in ("2" of cheese?).
        if (!u || /^\s*(reserve|units?)\s*$/i.test(u)) return setError("Give it a unit it's counted in, like bottles, bags, gallons or boxes.");
        setBusy(true);
        const err = await onSave({ id: initial.id, name, area, section: section || null, par_qty: parQty, unit: u, unit_size: sz || null, count_step: step, source: source || null });
        setBusy(false);
        setError(err);
      }}
    >
      <label className="block sm:col-span-2">
        <div className="label-xs">Item</div>
        <input id="par-name" className="input !py-3 !text-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Royale stickers" autoFocus />
      </label>
      <label className="block">
        <div className="label-xs">Sheet</div>
        <input id="par-area" className="input" list="par-areas" value={area} onChange={(e) => setArea(e.target.value)} />
        <datalist id="par-areas">{uniq(all.map((i) => i.area)).map((a) => <option key={a} value={a} />)}</datalist>
      </label>
      <label className="block">
        <div className="label-xs">Section</div>
        <input id="par-section" className="input" list="par-sections" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Candy" />
        <datalist id="par-sections">{uniq(all.filter((i) => i.area === area).map((i) => i.section)).map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="block">
        <div className="label-xs">Par (how many to keep on hand)</div>
        <input id="par-qty" className="input" inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} placeholder="e.g. 1 or 0.5" />
      </label>
      <label className="block">
        <div className="label-xs">Unit it&apos;s counted in (required)</div>
        <input id="par-unit" className="input" list="par-units" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. bottles, bags, gallons" />
        <datalist id="par-units">
          {units.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <div className="label-xs">Size of one (optional)</div>
        <input id="par-size" className="input" list="par-sizes" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 750 ml, 1.75 L, 12.5 lb" maxLength={40} />
        <datalist id="par-sizes">
          {sizes.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <div className="block">
        <div className="label-xs" id="par-step-label">
          Count by
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="par-step-label">
          {STEP_CHOICES.map((c) => (
            <button
              key={String(c.v)}
              type="button"
              role="radio"
              aria-checked={step === c.v}
              className={`chip min-h-11 !px-4 !text-sm ${step === c.v ? "chip-selected font-bold" : ""}`}
              onClick={() => setStep(c.v)}
            >
              {c.v === null ? `${c.label} (${autoWhat})` : c.label}
            </button>
          ))}
        </div>
        <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          What − and + move by. Quarters suit bottles, kegs and jugs that get opened.
        </div>
      </div>
      <label className="block sm:col-span-2">
        <div className="label-xs">Where it&apos;s bought</div>
        <input id="par-source" className="input" list="par-sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Walmart" />
        <datalist id="par-sources">{uniq(all.map((i) => i.source)).map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      {error && <p className="text-sm sm:col-span-2" style={{ color: "var(--danger-text)" }}>{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy || !name.trim() || !area.trim()}>
          {busy ? "Saving…" : initial.id ? "Save item" : "Add item"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
