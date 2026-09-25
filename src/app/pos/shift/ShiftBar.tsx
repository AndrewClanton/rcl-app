"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOpsApi } from "./api";
import type { OnShift, ShiftStatus } from "@/lib/ops/shared";
import OpsPanel, { type OpsTab } from "./OpsPanel";

// The register's shift tools: who's working, reminders, and the buttons that
// open the checklist, par count, shopping list and history. Sits above the
// register and refreshes every minute.

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

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default function ShiftBar({ staff }: { staff: { id: string; name: string }[] }) {
  const api = useOpsApi();
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [meShift, setMeShift] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ tab: OpsTab; closing?: boolean } | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);

  const refresh = useCallback(async () => {
    const s = await api.getShiftStatus().catch(() => null);
    if (!s) return setError("The shift tools couldn't reach the server. Check the connection.");
    setError(null);
    setStatus(s);
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
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const me: OnShift | null = status?.onShift.find((o) => o.shiftId === meShift) ?? null;
  const tasksLeft = status?.tasks.filter((t) => !t.done).length ?? 0;

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

  return (
    <>
      <div className="card mb-3 flex flex-wrap items-center gap-x-4 gap-y-3 !py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="eyebrow">On shift</span>
          {status && status.onShift.length === 0 && (
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              Nobody yet
            </span>
          )}
          {status?.onShift.map((o) => (
            <button
              key={o.shiftId}
              className={`chip !px-3 !py-1.5 !text-sm ${o.shiftId === meShift ? "chip-selected font-bold" : ""}`}
              onClick={() => {
                writeMe(o.shiftId);
                setMeShift(o.shiftId);
              }}
              title="Tap to say this is you"
            >
              {o.name} <span style={{ color: "var(--muted)" }}>· since {time(o.startedAt)}</span>
            </button>
          ))}
          <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => setStartOpen(true)}>
            Start shift
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className="btn-secondary !px-3 !py-2 text-sm" onClick={() => setPanel({ tab: "checklist" })}>
            Checklist
            {tasksLeft > 0 && <span className="ml-1.5 rounded-full px-1.5 text-xs text-white" style={{ background: "var(--accent)" }}>{tasksLeft}</span>}
          </button>
          <button className="btn-secondary !px-3 !py-2 text-sm" onClick={() => setPanel({ tab: "par" })}>
            Par sheet
          </button>
          <button className="btn-secondary !px-3 !py-2 text-sm" onClick={() => setPanel({ tab: "shopping" })}>
            Shopping list
            {status?.lastCount && status.lastCount.below > 0 && <span className="ml-1.5 text-xs">({status.lastCount.below})</span>}
          </button>
          <button className="btn-secondary !px-3 !py-2 text-sm" onClick={() => setPanel({ tab: "history" })}>
            History
          </button>
          {me && (
            <button className="btn-primary !px-3 !py-2 text-sm" onClick={() => setEndOpen(true)}>
              End shift
            </button>
          )}
        </div>
        {error && (
          <div className="w-full text-xs" style={{ color: "var(--danger-text)" }}>
            {error}
          </div>
        )}
      </div>

      {status && status.reminders.length > 0 && (
        <div className="mb-3 grid gap-2">
          {status.reminders.map((r) => (
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
                className="rounded-lg border-2 px-4 py-2 text-sm font-bold"
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

      {startOpen && (
        <Dialog title="Who's starting a shift?" onClose={() => setStartOpen(false)} closeLabel="Not now">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {staff
              .filter((s) => !status?.onShift.some((o) => o.employeeId === s.id))
              .map((s) => (
                <button key={s.id} className="btn-secondary !py-4 text-base" onClick={() => begin(s.id)}>
                  {s.name}
                </button>
              ))}
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            Not listed? Add them in Admin → Staff.
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
      {closingLeft.length > 0 && (
        <div className="notice notice-warn mb-4">
          <div className="font-bold">
            {closingLeft.length} closing task{closingLeft.length === 1 ? " isn't" : "s aren't"} ticked off
          </div>
          <div className="mt-1">{closingLeft.map((t) => t.title).join(" · ")}</div>
          <button className="mt-2 font-bold underline" onClick={onOpenChecklist}>
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
          <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
