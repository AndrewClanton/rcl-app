"use client";

import { useEffect, useMemo, useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { searchMenu, searchPar, strongMenuMatches, suggestMenuItems } from "@/lib/ops/ran-out-search";
import { OUT_LABEL_MAX, OUT_NOTE_MAX, midSentence, parLabel, type RanOutOptions, type RegisterOut } from "@/lib/ops/shared";
import { useOpsApi } from "./api";
import { dropOut, refreshOuts } from "./ran-out-store";

// "Ran out" (86 it): the sheet staff report from, and what tapping an 86'd
// button asks. The OUT look on a menu button is in components/menu/MenuTile.

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

type ParOpt = RanOutOptions["parItems"][number];
type MenuOpt = RanOutOptions["menu"][number];
type Picked = { kind: "par"; item: ParOpt } | { kind: "typed"; label: string };

// ---------- the sheet ----------

export function RanOutSheet({
  employeeId,
  employeeName,
  shiftId,
  onClose,
  onSaved,
}: {
  employeeId: string | null;
  employeeName: string | null;
  shiftId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const api = useOpsApi();
  const [opts, setOpts] = useState<RanOutOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [menuQuery, setMenuQuery] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getRanOutOptions()
      .then((o) => alive && setOpts(o))
      .catch(() => alive && setLoadError("Couldn't load the par sheet. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parMatches = useMemo(() => (opts && query.trim() ? searchPar(query, opts.parItems) : []), [opts, query]);
  const menuById = useMemo(() => new Map((opts?.menu ?? []).map((m) => [m.id, m])), [opts]);
  const what = picked ? (picked.kind === "par" ? picked.item.name : picked.label) : "";
  const suggested = useMemo(
    () => (opts && picked ? suggestMenuItems(what, picked.kind === "par" ? picked.item.section : null, opts.menu) : []),
    [opts, picked, what],
  );
  const menuMatches = useMemo(() => (opts && menuQuery.trim() ? searchMenu(menuQuery, opts.menu) : []), [opts, menuQuery]);
  const alreadyOut = picked?.kind === "par" ? opts?.open[picked.item.id] : undefined;

  function pick(p: Picked) {
    setPicked(p);
    setError(null);
    // Start ticked: menu items whose recipe uses this par line, and ones
    // that plainly are it or are made around it by name (Hot dog buns →
    // Hot dog), so their buttons say OUT without anyone hunting for them.
    const byRecipe = p.kind === "par" ? (opts?.recipeUses[p.item.id] ?? []) : [];
    const byName = opts ? strongMenuMatches(p.kind === "par" ? p.item.name : p.label, p.kind === "par" ? p.item.section : null, opts.menu).map((m) => m.id) : [];
    setTicked(new Set([...byRecipe, ...byName]));
  }

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const r = await api
      .reportOutage(
        {
          parItemId: picked.kind === "par" ? picked.item.id : null,
          label: picked.kind === "typed" ? picked.label : null,
          note: note.trim() || null,
          menuItemIds: [...ticked],
        },
        employeeId,
        shiftId,
      )
      .catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't save that. Check the connection and try again.");
    const stopped = r.stopped.length ? `${r.stopped.join(", ")} now show${r.stopped.length === 1 ? "s" : ""} OUT. ` : "";
    onSaved(`${stopped}${r.todo ? `The managers have a to-do to buy more ${midSentence(r.name)}.` : `${r.name} is on the managers' shopping list.`}`);
  }

  const tickedItems = [...ticked].map((id) => menuById.get(id)).filter((m): m is MenuOpt => !!m);
  const chip = (m: MenuOpt) => {
    const on = ticked.has(m.id);
    return (
      <button
        key={m.id}
        type="button"
        className={`chip min-h-11 !px-3.5 !py-2 !text-sm ${on ? "chip-selected font-bold" : ""}`}
        aria-pressed={on}
        onClick={() => toggle(m.id)}
      >
        {on ? "✓ " : "+ "}
        {m.name}
        {m.outSince && <span className="ml-1 text-xs opacity-70">(already out)</span>}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="Ran out">
      <div className="card w-full max-w-2xl shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">
              Ran out
              <InfoTip topic="ran-out" />
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              The menu buttons that need it show OUT, and the managers get a to-do to buy more.
            </p>
          </div>
          <button className="min-h-11 px-2 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onClose}>
            Cancel
          </button>
        </div>

        {loadError && <p style={{ color: "var(--danger-text)" }}>{loadError}</p>}
        {!opts && !loadError && <p style={{ color: "var(--muted)" }}>Loading…</p>}

        {opts && !picked && (
          <div>
            <label className="block">
              <div className="label-xs">What ran out?</div>
              <input
                id="ran-out-search"
                className="input !py-3 !text-base"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. hot dog buns, limes, cups"
                autoComplete="off"
                maxLength={OUT_LABEL_MAX}
                autoFocus
              />
            </label>
            {query.trim() && (
              <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                {parMatches.map((p, idx) => {
                  const open = opts.open[p.id];
                  return (
                    <button
                      key={p.id}
                      className={`flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-[var(--surface-hover)] ${idx ? "border-t" : ""}`}
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => pick({ kind: "par", item: p })}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{p.name}</span>
                        <span className="block text-xs" style={{ color: "var(--muted)" }}>
                          {p.section ? `${p.area} › ${p.section}` : p.area} · Par {parLabel(p)}
                          {p.source ? ` · ${p.source}` : ""}
                        </span>
                      </span>
                      {open && (
                        <span className="rounded px-2 py-0.5 text-xs font-bold" style={{ background: "var(--warn-bg)", color: "var(--warn-text)" }}>
                          Already out since {clock(open.at)}
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  className={`flex min-h-14 w-full items-center px-4 py-3 text-left text-sm hover:bg-[var(--surface-hover)] ${parMatches.length ? "border-t" : ""}`}
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => pick({ kind: "typed", label: query.replace(/\s+/g, " ").trim() })}
                >
                  <span>
                    {parMatches.length === 0 && <span className="block text-xs" style={{ color: "var(--muted)" }}>Nothing on the par sheet matches.</span>}
                    Not on the par sheet: <strong>&ldquo;{query.trim()}&rdquo;</strong>
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {opts && picked && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-3" style={{ borderColor: "var(--foreground)" }}>
              <div className="min-w-0 flex-1">
                <div className="font-display text-xl">{what}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {picked.kind === "par"
                    ? `${picked.item.section ? `${picked.item.area} › ${picked.item.section}` : picked.item.area} · Par ${parLabel(picked.item)}${picked.item.source ? ` · ${picked.item.source}` : ""}`
                    : "Not on the par sheet"}
                </div>
              </div>
              <button className="chip min-h-11 !px-4 !text-sm" onClick={() => setPicked(null)}>
                Change
              </button>
            </div>
            {alreadyOut && (
              <div className="notice notice-warn">
                Already reported out at {clock(alreadyOut.at)}
                {alreadyOut.byName ? ` by ${alreadyOut.byName}` : ""}. Saving adds to that report.
              </div>
            )}

            <section>
              <h3 className="font-display text-lg">Stop selling these?</h3>
              <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
                Ticked items show OUT on their buttons until it&apos;s bought or someone taps It&apos;s back. The ones that need it start ticked.
              </p>
              <div className="flex flex-wrap gap-2">
                {tickedItems.map(chip)}
                {suggested.filter((m) => !ticked.has(m.id)).map(chip)}
              </div>
              {tickedItems.length === 0 && suggested.length === 0 && (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Nothing ticked: the register keeps selling everything. Find a menu item below to stop it.
                </p>
              )}
              <input
                id="ran-out-menu-search"
                className="input mt-3 !py-2.5 !text-base"
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                placeholder="Find a menu item to stop, e.g. hot dog"
                autoComplete="off"
              />
              {menuQuery.trim() && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {menuMatches.length ? menuMatches.map(chip) : <span className="text-sm" style={{ color: "var(--muted)" }}>No menu item matches.</span>}
                </div>
              )}
            </section>

            <label className="block">
              <div className="label-xs">Note (optional)</div>
              <input
                id="ran-out-note"
                className="input !py-2.5 !text-base"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. used the last sleeve at 7:45"
                maxLength={OUT_NOTE_MAX}
                autoComplete="off"
              />
            </label>

            {error && <p className="text-sm font-bold" style={{ color: "var(--danger-text)" }}>{error}</p>}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <span className="text-sm" style={{ color: "var(--muted)" }}>
                {employeeName ? `Reported by ${employeeName}` : "Nobody's on shift here, so it won't say who reported it."}
              </span>
              <div className="ml-auto flex gap-2">
                <button className="btn-secondary min-h-12" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn-primary min-h-12 !px-6 !text-base" disabled={busy} onClick={save}>
                  {busy ? "Saving…" : ticked.size ? `Save and stop ${ticked.size}` : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Tapping an 86'd button: sell it anyway, or it's back. When it's the last
// item that report stopped, It's back asks whether more was bought, so the
// shopping list doesn't send someone out for it again.
export function ItemOutDialog({
  item,
  out,
  outs,
  employeeId,
  onSell,
  onClose,
}: {
  item: { id: string; name: string };
  out: RegisterOut;
  outs: RegisterOut[];
  employeeId: string | null;
  onSell: () => void;
  onClose: () => void;
}) {
  const api = useOpsApi();
  const [step, setStep] = useState<"ask" | "restock">("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastForReport = !!out.outageId && !!out.what && outs.filter((o) => o.outageId === out.outageId).length === 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function back(resolution: "bought" | "found" | null) {
    setBusy(true);
    setError(null);
    const r = await api.markItemBack(item.id, resolution, employeeId).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't save that. Check the connection.");
    dropOut(item.id);
    refreshOuts();
    onClose();
  }

  const big = "min-h-14 w-full !text-base";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`${item.name} is out`}>
      <div className="card w-full max-w-sm shadow-2xl">
        <div className="eyebrow mb-1">{item.name}</div>
        {step === "ask" ? (
          <>
            <h3 className="font-display text-xl leading-snug">{out.reason}. Sell anyway?</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Since {clock(out.since)}
            </p>
            <div className="mt-4 grid gap-2">
              <button className={`btn-secondary ${big}`} disabled={busy} onClick={onSell}>
                Sell anyway
              </button>
              <button className={`btn-primary ${big}`} disabled={busy} onClick={() => (lastForReport ? setStep("restock") : back(null))}>
                {busy ? "Saving…" : "It's back"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="font-display text-xl leading-snug">Did someone get more {midSentence(out.what ?? "")}?</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              So the managers know whether they still need to buy it.
            </p>
            <div className="mt-4 grid gap-2">
              <button className={`btn-primary ${big}`} disabled={busy} onClick={() => back("bought")}>
                Yes, bought more
              </button>
              <button className={`btn-secondary ${big}`} disabled={busy} onClick={() => back("found")}>
                Found some in the back
              </button>
              <button className={`btn-secondary ${big}`} disabled={busy} onClick={() => back(null)}>
                No, it still needs buying
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="mt-3 text-sm font-bold" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
        <button className="mt-3 min-h-11 w-full text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
