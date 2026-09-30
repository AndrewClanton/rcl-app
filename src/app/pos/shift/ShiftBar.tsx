"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOpsApi } from "./api";
import { isManagerRole, type OnShift, type ShiftStatus, type ShiftTodo } from "@/lib/ops/shared";
import OpsPanel, { type OpsTab } from "./OpsPanel";
import { publishOnShift } from "./on-shift-store";
import BoothsToday from "./BoothsToday";
import TrainingWindow from "./TrainingWindow";
import { RanOutSheet } from "./RanOut";
import { publishOuts, setOutsRefresher, useRanOut } from "./ran-out-store";
import MyHours from "./MyHours";

// The register's shift tools: who's working, reminders, and the buttons that
// open the checklist, par count, shopping list, reminders and history. Sits
// above the register and refreshes every minute.

const ME_KEY = "rcl.shift.me";
const readMe = () => {
  try {
    return localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
};
const writeMe = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ME_KEY, id);
    else localStorage.removeItem(ME_KEY);
  } catch {}
};

// "Remind me later" hides a reminder on this tablet for an hour. Kept on the
// device (not the database) since it's about this moment at this register;
// Done is still what clears it for good.
const SNOOZE_KEY = "rcl.shift.snoozed";
const SNOOZE_MS = 60 * 60 * 1000;
const readSnoozed = (): Record<string, number> => {
  try {
    const all = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now));
  } catch {
    return {};
  }
};
const writeSnoozed = (m: Record<string, number>) => {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(m));
  } catch {}
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default function ShiftBar({ staff, signedInRole }: { staff: { id: string; name: string; role: string }[]; signedInRole: string }) {
  const api = useOpsApi();
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [meShift, setMeShift] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ tab: OpsTab; closing?: boolean } | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const s = await api.getShiftStatus().catch(() => null);
    if (!s) return setError("The shift tools couldn't reach the server. Check the connection.");
    setError(null);
    setStatus(s);
    publishOuts(s.outs ?? []);
    setSnoozed(readSnoozed());
    // Who's using this tablet: the person picked here before, if they're
    // still on shift, else whoever started most recently.
    const saved = readMe();
    const pick = s.onShift.find((o) => o.shiftId === saved) ?? s.onShift[s.onShift.length - 1] ?? null;
    setMeShift(pick?.shiftId ?? null);
    // Opening the register with nobody on shift asks who's starting, once.
    if (!prompted.current) {
      prompted.current = true;
      if (s.onShift.length === 0) setStartOpen(true);
    }
  }, [api]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // The register asks for a refresh after putting an item back on sale.
    const unhook = setOutsRefresher(refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unhook();
    };
  }, [refresh]);

  const me: OnShift | null = status?.onShift.find((o) => o.shiftId === meShift) ?? null;
  const reminders = (status?.reminders ?? []).filter((r) => !snoozed[`${r.reminderId}:${r.occurrence}`]);
  const tasksLeft = status?.tasks.filter((t) => !t.done).length ?? 0;
  const { cashierId } = useRanOut();
  // A manager (or above) is here: signed in on this iPad, or the person on
  // shift using it, or the register's cashier. Only then does the bar show
  // the managers' to-dos and how much has run out: the cashier can't go
  // shopping mid-shift, so they only see OUT on the menu buttons.
  const roleOf = (id: string | null | undefined) => (id ? staff.find((s) => s.id === id)?.role : undefined);
  const managerHere = isManagerRole(signedInRole) || isManagerRole(roleOf(me?.employeeId)) || isManagerRole(roleOf(cashierId));
  // To-dos from Back office → Team: the ones for whoever's on shift, and the
  // ones for anybody who's on right now (labelled with their name). The
  // managers' ones (restocking what ran out) only while a manager's here.
  const onShiftIds = new Set((status?.onShift ?? []).map((o) => o.employeeId));
  const todos = (status?.todos ?? []).filter((t) => (t.forManagers ? managerHere : !t.assigneeId || onShiftIds.size === 0 || onShiftIds.has(t.assigneeId)));
  const [justDone, setJustDone] = useState<{ id: string; title: string; note: string | null; undo: boolean } | null>(null);
  // Assigned training for whoever's on shift, opened in a window over the register.
  const training = status?.training ?? [];
  const [trainingOpen, setTrainingOpen] = useState<{ slug: string; employeeId: string; name: string } | null>(null);
  const [todoError, setTodoError] = useState<string | null>(null);
  // "Ran out": reported by the register's cashier, else whoever's using this iPad.
  const [ranOutOpen, setRanOutOpen] = useState(false);
  const [ranOutSaved, setRanOutSaved] = useState<string | null>(null);
  const reporterId = cashierId ?? me?.employeeId ?? null;
  const reporterName = reporterId ? (staff.find((s) => s.id === reporterId)?.name ?? status?.onShift.find((o) => o.employeeId === reporterId)?.name ?? null) : null;
  const reporterShift = status?.onShift.find((o) => o.employeeId === reporterId)?.shiftId ?? me?.shiftId ?? null;

  // Tell the register who's working, so the cashier fills itself in.
  useEffect(() => {
    publishOnShift(status?.onShift ?? [], me?.employeeId ?? null);
  }, [status, me]);

  async function begin(employeeId: string) {
    const r = await api.startShift(employeeId).catch(() => null);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't start the shift.");
    writeMe(r.shiftId);
    setStartOpen(false);
    await refresh();
    setPanel({ tab: "checklist" });
  }

  async function finish(closedForNight: boolean) {
    if (!me) return;
    const r = await api.endShift(me.shiftId, closedForNight).catch(() => null);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't end the shift.");
    writeMe(null);
    setPanel(null);
    setEndOpen(false);
    await refresh();
  }

  async function todoDone(t: ShiftTodo) {
    setTodoError(null);
    // A to-do for Caleb is done by Caleb, whoever's tapping. A restock one
    // (Bought it) by whoever's at the register, like Ran out itself.
    const by = t.assigneeId ?? (t.outageId ? reporterId : me?.employeeId) ?? null;
    const r = await api.setTodoDone(t.id, by).catch(() => null);
    if (!r || !r.ok) return setTodoError(`"${t.title}" didn't save. Tap ${t.outageId ? "Bought it" : "Done"} again.`);
    // Buying it closes its Ran out report: what it stopped is back on sale.
    const back = r.restock?.back ?? [];
    setJustDone({ id: t.id, title: t.title, note: back.length ? `Back on sale: ${back.join(", ")}.` : null, undo: !t.outageId });
    setTimeout(() => setJustDone((j) => (j?.id === t.id ? null : j)), t.outageId ? 10_000 : 6000);
    refresh();
  }

  // Reminders tapped "Remind me later": they come back on their own, and
  // Reminders (under More) lists them in the meantime.
  const snoozedDue = (status?.reminders ?? [])
    .map((r) => ({ ...r, key: `${r.reminderId}:${r.occurrence}`, until: snoozed[`${r.reminderId}:${r.occurrence}`] }))
    .filter((r) => !!r.until);
  const belowPar = status?.lastCount?.below ?? 0;
  const outCount = managerHere ? (status?.ranOut ?? 0) : 0;

  return (
    <>
      {/* One slim row on the iPad, held either way: who's on (scrolls
          sideways if it's a crowd) on the left, shift tools on the right.
          Upright, Par count and Shopping list move under More so the row
          still fits; a phone lets it wrap. */}
      <div className="card mb-2 !px-3 !py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:flex-nowrap">
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-1 md:flex-nowrap md:overflow-x-auto">
            {/* Upright, the label, start times and hint step aside so the names
                and Start shift fit beside the tools. */}
            <span className={`eyebrow shrink-0 ${status?.onShift.length ? "md:max-lg:hidden" : ""}`}>On shift</span>
            {status && status.onShift.length === 0 && (
              <span className="shrink-0 text-sm" style={{ color: "var(--muted)" }}>
                Nobody yet
              </span>
            )}
            {status?.onShift.map((o) => (
              <button
                key={o.shiftId}
                className={`chip shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm min-h-11 ${o.shiftId === meShift ? "chip-selected font-bold" : ""}`}
                onClick={() => {
                  writeMe(o.shiftId);
                  setMeShift(o.shiftId);
                }}
                title={`Started ${time(o.startedAt)}. Tap to say this is you.`}
              >
                {o.name}{" "}
                <span className="md:max-lg:hidden" style={{ color: "var(--muted)" }}>
                  · {time(o.startedAt)}
                </span>
              </button>
            ))}
            {status && status.onShift.length > 1 && (
              <span className="shrink-0 text-xs md:max-lg:hidden" style={{ color: "var(--muted)" }}>
                Tap your name if it&apos;s you
              </span>
            )}
            <button className="btn-secondary min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm" onClick={() => setStartOpen(true)}>
              Start shift
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">
            <button
              className="btn-secondary btn-ran-out min-h-11 whitespace-nowrap !px-3 !py-1.5 text-sm"
              onClick={() => {
                setRanOutSaved(null);
                setRanOutOpen(true);
              }}
            >
              Ran out
            </button>
            <button className={BAR_BUTTON} onClick={() => setPanel({ tab: "checklist" })}>
              Checklist
              {tasksLeft > 0 && <CountBadge>{tasksLeft}</CountBadge>}
            </button>
            {/* On the bar when there's room (an iPad on its side), else under More. */}
            <button className={`${BAR_BUTTON} hidden lg:inline-block`} onClick={() => setPanel({ tab: "par" })}>
              Par count
            </button>
            <button className={`${BAR_BUTTON} hidden lg:inline-block`} onClick={() => setPanel({ tab: "shopping" })}>
              Shopping
              {belowPar > 0 && <span className="ml-1.5 text-xs">({belowPar})</span>}
              {outCount > 0 && <OutBadge n={outCount} />}
            </button>
            <MoreMenu
              badge={outCount > 0 ? <OutBadge n={outCount} className="lg:hidden" /> : null}
              items={[
                { tab: "par", label: "Par count", onBar: true },
                {
                  tab: "shopping",
                  label: "Shopping list",
                  onBar: true,
                  note: (belowPar > 0 || outCount > 0) && (
                    <>
                      {belowPar > 0 && <span className="text-xs font-normal">{belowPar} below par</span>}
                      {outCount > 0 && <OutBadge n={outCount} />}
                    </>
                  ),
                },
                { tab: "reminders", label: "Reminders", note: snoozedDue.length > 0 && <span className="text-xs font-normal">{snoozedDue.length} snoozed</span> },
                { tab: "history", label: "History" },
              ]}
              onPick={(tab) => setPanel({ tab })}
            />
            {me && (
              <button className="btn-primary min-h-11 whitespace-nowrap !px-3 !py-1.5 text-sm" onClick={() => setEndOpen(true)}>
                End shift
              </button>
            )}
          </div>
        </div>
        {me && <MyHours shiftId={me.shiftId} />}
        {error && (
          <div className="mt-1.5 text-xs" style={{ color: "var(--danger-text)" }}>
            {error}
          </div>
        )}
      </div>

      {ranOutSaved && (
        <div className="notice notice-success mb-2 flex flex-wrap items-center gap-3 !px-4 !py-2 text-sm" role="status">
          <span className="min-w-0 flex-1">{ranOutSaved}</span>
          <button className="min-h-11 px-2 font-bold underline" onClick={() => setRanOutSaved(null)}>
            OK
          </button>
        </div>
      )}

      {ranOutOpen && (
        <RanOutSheet
          employeeId={reporterId}
          employeeName={reporterName}
          shiftId={reporterShift}
          onClose={() => setRanOutOpen(false)}
          onSaved={(message) => {
            setRanOutOpen(false);
            setRanOutSaved(message);
            setTimeout(() => setRanOutSaved((m) => (m === message ? null : m)), 10_000);
            refresh();
          }}
        />
      )}

      {status && <BoothsToday booths={status.booths} onChanged={refresh} />}

      {reminders.length > 0 && (
        <div className="mb-3 grid gap-2">
          {reminders.map((r) => (
            <div
              key={`${r.reminderId}:${r.occurrence}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-2.5"
              style={{ background: r.urgent ? "var(--accent)" : "var(--gold)", borderColor: "var(--foreground)", color: r.urgent ? "#fff" : "var(--gold-foreground)" }}
              role="status"
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {r.assigneeName ? `${r.assigneeName}: ` : ""}
                  {r.message}
                </div>
                <div className="text-sm opacity-90">{r.detail}</div>
              </div>
              <button
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-bold underline"
                onClick={() => {
                  const next = { ...readSnoozed(), [`${r.reminderId}:${r.occurrence}`]: Date.now() + SNOOZE_MS };
                  writeSnoozed(next);
                  setSnoozed(next);
                }}
              >
                Remind me later
              </button>
              <button
                className="min-h-11 rounded-lg border-2 px-4 py-2 text-sm font-bold"
                style={{ borderColor: "currentColor" }}
                onClick={async () => {
                  await api.dismissReminder(r.reminderId, r.occurrence, me?.employeeId ?? null).catch(() => null);
                  refresh();
                }}
              >
                Done
              </button>
            </div>
          ))}
        </div>
      )}

      {(justDone || todoError) && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-2 text-sm" style={{ borderColor: "var(--foreground)" }}>
          {todoError ? (
            <span className="font-bold" style={{ color: "var(--danger-text)" }}>
              {todoError}
            </span>
          ) : (
            justDone && (
              <>
                <span className="flex-1">
                  Done: <strong>{justDone.title}</strong>
                  {justDone.note && <span className="block">{justDone.note}</span>}
                </span>
                {/* A restock to-do closed its Ran out report too, so it has no Undo. */}
                {justDone.undo ? (
                  <button
                    className="min-h-11 px-3 font-bold underline"
                    onClick={async () => {
                      const id = justDone.id;
                      setJustDone(null);
                      await api.undoTodoDone(id).catch(() => null);
                      refresh();
                    }}
                  >
                    Undo
                  </button>
                ) : (
                  <button className="min-h-11 px-3 font-bold underline" onClick={() => setJustDone(null)}>
                    OK
                  </button>
                )}
              </>
            )
          )}
        </div>
      )}

      {todos.length > 0 && (
        <div className="mb-3 grid gap-2">
          {todos.map((t) => {
            const overdue = t.dueDate !== null && status !== null && t.dueDate < status.workDate;
            const dueToday = t.dueDate !== null && status !== null && t.dueDate === status.workDate;
            return (
              <div
                key={t.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-2.5"
                style={{ background: "var(--foreground)", borderColor: "var(--foreground)", color: "var(--background)" }}
                role="status"
              >
                <span className="rounded bg-[var(--gold)] px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-[var(--gold-foreground)]">
                  {t.outageId ? "Restock" : t.forManagers ? "Managers" : "To-do"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">
                    {t.assigneeName ? `${t.assigneeName}: ` : ""}
                    {t.title}
                  </div>
                  <div className="text-sm opacity-80">
                    {[
                      // A restock to-do's details already say who reported it.
                      t.fromName && !t.outageId && `From ${t.fromName}`,
                      overdue ? "Overdue" : dueToday ? "Due today" : t.dueDate && `Due ${new Date(`${t.dueDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`,
                      t.details,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  className="min-h-11 rounded-lg border-2 px-4 py-2 text-sm font-bold"
                  style={{ borderColor: "currentColor" }}
                  onClick={() => todoDone(t)}
                >
                  {t.outageId ? "Bought it" : "Done"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {training.length > 0 && (
        <div className="mb-3 grid gap-2">
          {training.map((t) => (
            <div
              key={`${t.employeeId}:${t.slug}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-2.5"
              style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}
            >
              <span className="rounded bg-[var(--foreground)] px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-[var(--gold)]">Training</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {t.name}: {t.title}
                </div>
                <div className="text-sm" style={{ color: t.overdue ? "var(--danger-text)" : "var(--muted)" }}>
                  {[
                    t.updated && "Updated, sign again",
                    t.overdue ? "Overdue" : t.dueDate && `Due ${new Date(`${t.dueDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`,
                    "Open it when things are slow",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button
                className="min-h-11 rounded-lg border-2 px-4 py-2 text-sm font-bold"
                style={{ borderColor: "var(--foreground)" }}
                onClick={() => setTrainingOpen({ slug: t.slug, employeeId: t.employeeId, name: t.name })}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}

      {trainingOpen && (
        <TrainingWindow
          {...trainingOpen}
          onClose={(signed) => {
            setTrainingOpen(null);
            if (signed) refresh();
          }}
        />
      )}

      {startOpen && (
        <Dialog title="Who's starting a shift?" onClose={() => setStartOpen(false)} closeLabel="Not now">
          {(() => {
            const free = staff.filter((s) => !status?.onShift.some((o) => o.employeeId === s.id));
            const today = free.filter((s) => status?.scheduled[s.id]);
            const others = free.filter((s) => !status?.scheduled[s.id]);
            const tile = (s: { id: string; name: string }) => (
              <button key={s.id} className="btn-secondary min-h-16 !py-4 text-base" onClick={() => begin(s.id)}>
                {s.name}
                {status?.scheduled[s.id] && <span className="mt-0.5 block text-xs font-normal opacity-70">{status.scheduled[s.id]}</span>}
              </button>
            );
            return (
              <div className="space-y-4">
                {today.length > 0 && (
                  <div>
                    <div className="eyebrow mb-2">On today&apos;s schedule</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{today.map(tile)}</div>
                  </div>
                )}
                {others.length > 0 && (
                  <div>
                    {today.length > 0 && <div className="eyebrow mb-2">Everyone else</div>}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{others.map(tile)}</div>
                  </div>
                )}
              </div>
            );
          })()}
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            Not listed? Ask Andrew to add you on the Staff page.
          </p>
        </Dialog>
      )}

      {endOpen && me && status && (
        <EndShiftDialog
          me={me}
          status={status}
          onClose={() => setEndOpen(false)}
          onOpenChecklist={() => {
            setEndOpen(false);
            setPanel({ tab: "checklist" });
          }}
          onEndNow={() => finish(false)}
          onCount={() => {
            setEndOpen(false);
            setPanel({ tab: "par", closing: true });
          }}
        />
      )}

      {panel && (
        <OpsPanel
          tab={panel.tab}
          closing={!!panel.closing}
          manager={managerHere}
          me={me}
          status={status}
          staff={staff}
          snoozed={snoozedDue.map((r) => ({ key: r.key, message: r.assigneeName ? `${r.assigneeName}: ${r.message}` : r.message, detail: r.detail, until: r.until }))}
          onUnsnooze={(key) => {
            const next = readSnoozed();
            delete next[key];
            writeSnoozed(next);
            setSnoozed(next);
          }}
          onTab={(tab) => setPanel({ tab, closing: panel.closing })}
          onChanged={refresh}
          onClose={() => setPanel(null)}
          onFinishClosing={() => finish(true)}
        />
      )}
    </>
  );
}

function EndShiftDialog({
  me,
  status,
  onClose,
  onOpenChecklist,
  onEndNow,
  onCount,
}: {
  me: OnShift;
  status: ShiftStatus;
  onClose: () => void;
  onOpenChecklist: () => void;
  onEndNow: () => void;
  onCount: () => void;
}) {
  const lastOne = status.onShift.length <= 1;
  const [closing, setClosing] = useState(lastOne);
  const [busy, setBusy] = useState(false);
  const closingLeft = status.tasks.filter((t) => t.timing === "closing" && !t.done);

  return (
    <Dialog title={`End ${me.name}'s shift`} onClose={onClose} closeLabel="Cancel">
      {closing && closingLeft.length > 0 && (
        <div className="notice notice-warn mb-4">
          <div className="font-bold">
            {closingLeft.length} closing task{closingLeft.length === 1 ? " isn't" : "s aren't"} ticked off
          </div>
          <div className="mt-1">{closingLeft.map((t) => t.title).join(" · ")}</div>
          <button className="mt-1 min-h-11 font-bold underline" onClick={onOpenChecklist}>
            Open the checklist
          </button>
        </div>
      )}
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input id="closing-for-night" type="checkbox" className="mt-0.5 h-5 w-5" checked={closing} onChange={(e) => setClosing(e.target.checked)} />
        <span>
          <strong>I&apos;m closing for the night</strong>
          <span className="block" style={{ color: "var(--muted)" }}>
            Do the par count before you go, so the shopping list is ready tomorrow.
          </span>
        </span>
      </label>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {closing ? (
          <button className="btn-primary !py-3" onClick={onCount}>
            Start the par count
          </button>
        ) : (
          <button
            className="btn-primary !py-3"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onEndNow();
            }}
          >
            {busy ? "Ending…" : "End shift"}
          </button>
        )}
      </div>
    </Dialog>
  );
}

export function Dialog({ title, onClose, closeLabel = "Close", children }: { title: string; onClose: () => void; closeLabel?: string; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label={title}>
      <div className="card w-full max-w-lg shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-xl">{title}</h2>
          <button className="btn-quiet shrink-0" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// The shift bar's buttons, a full 44px to tap.
const BAR_BUTTON = "btn-secondary min-h-11 whitespace-nowrap !px-3 !py-1.5 text-sm";

// A count on a bar button: how many are left to do. Not a warning, so ink,
// not red.
function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 inline-block rounded-full px-1.5 text-xs tabular-nums" style={{ background: "var(--foreground)", color: "var(--surface)" }}>
      {children}
    </span>
  );
}

// "2 out": menu items stopped by Ran out, for a manager. That is a problem
// to fix, so it's the status red.
function OutBadge({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`ml-1.5 inline-block rounded-full px-1.5 text-xs tabular-nums text-white ${className}`} style={{ background: "var(--danger-fill)" }}>
      {n} out
    </span>
  );
}

// More: the shift tools that don't need to be on the bar all shift. Reminders
// and History always live here; Par count and Shopping list (onBar) join
// them when the bar is too narrow for their own buttons (an iPad held
// upright, a phone). Each opens its tab in the shift tools. `badge` shows on
// the button what's hidden inside.
function MoreMenu({
  items,
  badge,
  onPick,
}: {
  items: { tab: OpsTab; label: string; onBar?: boolean; note?: React.ReactNode }[];
  badge: React.ReactNode;
  onPick: (tab: OpsTab) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button className={BAR_BUTTON} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        More <span aria-hidden="true">▾</span>
        {badge}
      </button>
      {open && (
        <>
          {/* A tap anywhere else closes it. On a phone it opens along the
              bottom of the screen, under the thumb. */}
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="More shift tools"
            className="card fixed inset-x-3 bottom-3 z-40 !p-1.5 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-2 md:w-64"
          >
            {items.map((i) => (
              <button
                key={i.tab}
                role="menuitem"
                className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-bold active:bg-[var(--surface-hover)] ${i.onBar ? "lg:hidden" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onPick(i.tab);
                }}
              >
                <span>{i.label}</span>
                {i.note && <span className="flex items-center gap-1.5" style={{ color: "var(--muted)" }}>{i.note}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
