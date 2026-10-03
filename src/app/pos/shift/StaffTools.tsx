"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOpsApi } from "./api";
import { isManagerRole, scheduleAttention, type OnShift, type ShiftStatus, type ShiftTodo } from "@/lib/ops/shared";
import OpsPanel, { type OpsTab } from "./OpsPanel";
import { publishOnShift } from "./on-shift-store";
import TrainingWindow from "./TrainingWindow";
import { RanOutSheet } from "./RanOut";
import { publishOuts, setOutsRefresher, useRanOut } from "./ran-out-store";
import StaffSheet from "./StaffSheet";
import { publishStaff, setStaffHandlers, type StaffView } from "./staff-store";
import { Dialog } from "./ui";

// The register's shift tools: who's working, the checklist, Ran out, the
// par count and shopping list, the schedule, history and hours. They used
// to fill a bar across the top of the register (and the booths, to-dos and
// training under it), which took room the order and the menu need on an
// iPad. Now they live behind one Staff button beside the cashier
// (StaffButton.tsx), with a red count of what needs a look, and open in the
// Staff sheet (StaffSheet.tsx). Only reminders that are due still show
// above the register: they're about right now, and Done or Remind me later
// takes them away. Polls the server every minute.

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

export default function StaffTools({ staff, signedInRole }: { staff: { id: string; name: string; role: string }[]; signedInRole: string }) {
  const api = useOpsApi();
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [polledAt, setPolledAt] = useState(0);
  const [meShift, setMeShift] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StaffView | null>(null);
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
    setPolledAt(Date.now());
    publishOuts(s.outs ?? []);
    setSnoozed(readSnoozed());
    // Who's using this tablet: the person picked here before, if they're
    // still on shift, else whoever started most recently.
    const saved = readMe();
    const pick = s.onShift.find((o) => o.shiftId === saved) ?? s.onShift[s.onShift.length - 1] ?? null;
    setMeShift(pick?.shiftId ?? null);
    // Opening the register with nobody on shift asks who's starting, once.
    // After "Not now", the Staff button says Start shift until someone does.
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
    // The Staff and Booths buttons inside the register open things here.
    const unhandle = setStaffHandlers({ open: (v) => setSheet(v), startShift: () => setStartOpen(true), refresh });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unhook();
      unhandle();
    };
  }, [refresh]);

  const me: OnShift | null = status?.onShift.find((o) => o.shiftId === meShift) ?? null;
  const reminders = (status?.reminders ?? []).filter((r) => !snoozed[`${r.reminderId}:${r.occurrence}`]);
  const tasksLeft = status?.tasks.filter((t) => !t.done).length ?? 0;
  const { cashierId } = useRanOut();
  // A manager (or above) is here: signed in on this iPad, or the person on
  // shift using it, or the register's cashier. Only then does the sheet
  // show the managers' to-dos and the shopping list's "1 out" count.
  // Everyone sees the quiet "Out of …" lines: the purchasers are emailed,
  // so nobody on shift is asked to go buy it.
  const roleOf = (id: string | null | undefined) => (id ? staff.find((s) => s.id === id)?.role : undefined);
  const managerHere = isManagerRole(signedInRole) || isManagerRole(roleOf(me?.employeeId)) || isManagerRole(roleOf(cashierId));
  // To-dos from Back office → Team: the ones for whoever's on shift, and the
  // ones for anybody who's on right now (labelled with their name). The
  // managers' ones only while a manager's here.
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
  // Today's schedule: who's still coming in, and who's late (or forgot Start shift).
  const sched = scheduleAttention(status?.schedule ?? [], status?.onShift ?? [], polledAt);
  // The Staff button's red number: everything on the sheet that needs a look.
  const badge = tasksLeft + todos.length + training.length + (status?.outNotices?.length ?? 0) + sched.upcoming.length + sched.late.length;

  // Tell the register who's working, so the cashier fills itself in.
  useEffect(() => {
    publishOnShift(status?.onShift ?? [], me?.employeeId ?? null);
  }, [status, me]);

  // And what the Staff and Booths buttons show.
  useEffect(() => {
    publishStaff({ loaded: !!status, nobodyOn: !!status && status.onShift.length === 0, badge, offline: !!error, booths: status?.booths ?? null });
  }, [status, badge, error]);

  // A tool opened from the sheet takes the screen; closing it goes back to the register.
  function openPanel(tab: OpsTab) {
    setSheet(null);
    setPanel({ tab });
  }

  async function begin(employeeId: string) {
    const r = await api.startShift(employeeId).catch(() => null);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't start the shift.");
    writeMe(r.shiftId);
    setStartOpen(false);
    setSheet(null);
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
    // A to-do for Caleb is done by Caleb, whoever's tapping. (Restock to-dos
    // from Ran out aren't on the register: the purchasers are emailed.)
    const by = t.assigneeId ?? me?.employeeId ?? null;
    const r = await api.setTodoDone(t.id, by).catch(() => null);
    if (!r || !r.ok) return setTodoError(`"${t.title}" didn't save. Tap Done again.`);
    setJustDone({ id: t.id, title: t.title, note: null, undo: true });
    setTimeout(() => setJustDone((j) => (j?.id === t.id ? null : j)), 6000);
    refresh();
  }

  const feedback =
    justDone || todoError ? (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 px-3 py-2 text-sm" style={{ borderColor: "var(--foreground)" }} role="status">
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
    ) : null;

  return (
    <>
      {/* Due reminders stay in view above the register (a show starting
          soon, the day's jobs): they're about right now. */}
      {reminders.length > 0 && (
        <div className="mb-2 grid gap-2">
          {reminders.map((r) => (
            <div
              key={`${r.reminderId}:${r.occurrence}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-2"
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
                className="min-h-11 rounded-lg px-3 text-sm font-bold underline"
                onClick={() => {
                  const next = { ...readSnoozed(), [`${r.reminderId}:${r.occurrence}`]: Date.now() + SNOOZE_MS };
                  writeSnoozed(next);
                  setSnoozed(next);
                }}
              >
                Remind me later
              </button>
              <button
                className="min-h-11 rounded-lg border-2 px-4 text-sm font-bold"
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

      {/* Ran out saved: over the register for a moment, never pushing it down. */}
      {ranOutSaved && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" role="status">
          <div className="notice notice-success flex max-w-xl items-center gap-3 !px-4 !py-2 text-sm shadow-2xl">
            <span className="min-w-0 flex-1">{ranOutSaved}</span>
            <button className="min-h-11 px-2 font-bold underline" onClick={() => setRanOutSaved(null)}>
              OK
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <StaffSheet
          view={sheet}
          status={status}
          me={me}
          manager={managerHere}
          todos={todos}
          training={training}
          tasksLeft={tasksLeft}
          sched={sched}
          error={error}
          feedback={feedback}
          onView={setSheet}
          onClose={() => setSheet(null)}
          onPickMe={(shiftId) => {
            writeMe(shiftId);
            setMeShift(shiftId);
          }}
          onStart={() => setStartOpen(true)}
          onEnd={() => setEndOpen(true)}
          onRanOut={() => {
            setSheet(null);
            setRanOutSaved(null);
            setRanOutOpen(true);
          }}
          onPanel={openPanel}
          onTodoDone={todoDone}
          onTraining={(t) => {
            setSheet(null);
            setTrainingOpen({ slug: t.slug, employeeId: t.employeeId, name: t.name });
          }}
        />
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
            openPanel("checklist");
          }}
          onEndNow={() => {
            setSheet(null);
            finish(false);
          }}
          onCount={() => {
            setEndOpen(false);
            setSheet(null);
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
          <button className="mt-2 min-h-11 font-bold underline" onClick={onOpenChecklist}>
            Open the checklist
          </button>
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-3 text-sm">
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
