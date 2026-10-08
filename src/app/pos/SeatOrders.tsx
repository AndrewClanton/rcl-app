"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CountBadge, Dialog } from "./shift/ui";
import { setRegisterSeatStatus, setSeatOrderingOn } from "./seat-order-actions";
import { boardLabel, type SeatStatus } from "@/lib/seat-ordering";
import type { OpenSeatOrder, RegisterSeatOrders } from "@/lib/seat-ordering-server";
import ManagerPinModal from "@/components/ManagerPinModal";
import { chimeReady, listenForChimeUnlock, playRegisterChime } from "../display/seat-chime";

// Orders from guests' phones, on the register (lib/seat-ordering.ts): an
// "Order up" button and alert strip beside Staff and the list behind it,
// with Making and Delivered (the boards have the same buttons).
// Self-contained: it asks the server every 15 seconds while seat ordering is
// on (or something's waiting), once a minute while it's off, and draws
// nothing while it's off and nothing's waiting, so the register looks the
// same as without it. It asks through a plain GET (api/pos/seat-orders), not
// a Server Action, so a poll never makes the cashier's Charge wait.

const POLL_MS = 15_000;
const IDLE_POLL_MS = 60_000;

function useSeatOrders() {
  const [data, setData] = useState<RegisterSeatOrders | null>(null);
  // The last check failed: the last list stays up, with a note.
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async (): Promise<RegisterSeatOrders | null> => {
    try {
      const res = await fetch("/api/pos/seat-orders", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as RegisterSeatOrders;
      setData(r);
      setLoadFailed(false);
      setNow(Date.now());
      return r;
    } catch {
      setLoadFailed(true);
      setNow(Date.now());
      return null;
    }
  }, []);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasActive = false;
    const tick = async () => {
      if (stop) return;
      if (timer) clearTimeout(timer);
      const visible = document.visibilityState === "visible";
      const r = visible ? await load() : null;
      if (stop) return;
      // A failed check keeps the fast pace if orders were coming in.
      if (r) wasActive = r.enabled || r.orders.length > 0;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), visible && wasActive ? POLL_MS : IDLE_POLL_MS);
    };
    // An iPad waking up checks right away, not up to a minute later.
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
  return { data, load, setData, loadFailed, now };
}

function waitingFor(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just in" : `waiting ${m} min`;
}

// How often the chime repeats while an order is waiting to be seen.
const CHIME_REPEAT_MS = 20_000;
// How long Undo stays on an order after Making or Delivered.
const UNDO_MS = 6_000;
// Seen, but still "new" (nobody tapped Making) this long after: it alerts
// again.
const REALERT_MS = 3 * 60_000;
// A "new" order older than this is left to the list (no strip or chime): one
// nobody tapped through last night doesn't ring all of today.
const ALERT_FOR_MS = 2 * 3_600_000;

// When each order was last seen on this register (opening the list), kept
// through a reload so a reload doesn't ring again for orders already seen.
const SEEN_KEY = "rcl-seat-orders-seen";
function readSeen(): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, unknown>;
    return new Map(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    return new Map();
  }
}
function writeSeen(seen: Map<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seen)));
  } catch {
    // Storage blocked: it holds until the page reloads.
  }
}

// "Order up": the button beside Staff, plus, while a new paid order is
// waiting to be seen, a strip in the register's top rows and a chime that
// repeats every 20 seconds until someone taps the strip or the button
// (either opens the list). Each order is seen on its own: one that comes in
// later rings again, and one still "new" 3 minutes after it was seen rings
// again. Nothing rings while the list is open (what comes in then counts as
// seen). The strip takes its own row in the cart's header, never over the
// menu or the total, and names only the spot (the register faces the line).
// iPad Safari keeps sound off until the page is tapped, so any tap on the
// register wakes it (display/seat-chime.ts); until then the strip says
// "Tap for sound".
export function SeatOrdersButton() {
  const { data, load, setData, loadFailed, now } = useSeatOrders();
  const [open, setOpen] = useState(false);
  // What this register had seen, kept through a reload. (The server draws
  // nothing here, so reading storage on the first render is safe.)
  const [seen, setSeen] = useState<Map<string, number>>(() => (typeof window === "undefined" ? new Map() : readSeen()));
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // The last Making/Delivered change, undoable for a few seconds (a lit
  // button does nothing, so a stray tap can't step an order back).
  const [undo, setUndo] = useState<{ orderId: string; before: SeatStatus } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);
  // A register screen (payment, a dialog) is covering the page: the alert
  // shows as a slim strip above it too (code review M13).
  const [covered, setCovered] = useState(false);

  useEffect(() => listenForChimeUnlock(), []);

  const orders = data?.orders ?? [];
  const listKey = orders.map((o) => o.orderId).join(",");
  const onList = useRef<Set<string>>(new Set());
  useEffect(() => {
    onList.current = new Set(listKey ? listKey.split(",") : []);
  }, [listKey]);
  const freshIds = orders.filter((o) => o.status === "new").map((o) => o.orderId);
  // Alerts for any new paid order, whether or not seat ordering is still on
  // (one paid just after it was switched off still needs making).
  const alerting = orders.filter((o) => {
    if (o.status !== "new" || now - new Date(o.createdAt).getTime() > ALERT_FOR_MS) return false;
    const at = seen.get(o.orderId);
    return at === undefined || now - at >= REALERT_MS;
  });
  const alertKey = open ? "" : alerting.map((o) => o.orderId).join(",");

  useEffect(() => {
    if (!alertKey) return;
    const t = setInterval(() => setCovered(!!document.querySelector(".fixed.inset-0.z-50")), 700);
    return () => clearInterval(t);
  }, [alertKey]);

  useEffect(() => {
    if (!alertKey) return;
    playRegisterChime();
    const t = setInterval(playRegisterChime, CHIME_REPEAT_MS);
    return () => clearInterval(t);
  }, [alertKey]);

  const markSeen = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setSeen((prev) => {
      const at = Date.now();
      const next = new Map(prev);
      ids.forEach((id) => next.set(id, at));
      // Only what's still on the list is kept.
      for (const id of [...next.keys()]) if (!ids.includes(id) && !onList.current.has(id)) next.delete(id);
      writeSeen(next);
      return next;
    });
  }, []);
  // What comes in while the list is open is seen as it arrives.
  const openFreshKey = open ? freshIds.join(",") : "";
  useEffect(() => {
    if (openFreshKey) markSeen(openFreshKey.split(","));
  }, [openFreshKey, markSeen]);

  function openList() {
    markSeen(freshIds);
    setOpen(true);
  }

  if (!data || (!data.enabled && data.orders.length === 0)) return null;
  const fresh = freshIds.length;
  const waiting = data.orders.filter((o) => o.status !== "delivered").length;
  const first = alerting[0];
  const soundOff = alerting.length > 0 && !chimeReady();

  async function step(o: OpenSeatOrder, status: SeatStatus, offerUndo = true) {
    const before = o.status;
    if (before === status) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
    setFailed((f) => {
      const n = new Set(f);
      n.delete(o.orderId);
      return n;
    });
    setData((d) => (d ? { ...d, orders: d.orders.map((x) => (x.orderId === o.orderId ? { ...x, status } : x)) } : d));
    const ok = await setRegisterSeatStatus(o.orderId, status).catch(() => false);
    if (!ok) {
      setData((d) => (d ? { ...d, orders: d.orders.map((x) => (x.orderId === o.orderId ? { ...x, status: before } : x)) } : d));
      setFailed((f) => new Set(f).add(o.orderId));
      return;
    }
    if (offerUndo) {
      setUndo({ orderId: o.orderId, before });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    }
    await load();
  }

  // New first (oldest first), then Making; Delivered folded underneath.
  const rank = (st: SeatStatus) => (st === "new" ? 0 : st === "making" ? 1 : 2);
  const sorted = [...data.orders].sort((a, b) => rank(a.status) - rank(b.status) || a.createdAt.localeCompare(b.createdAt));
  const active = sorted.filter((o) => o.status !== "delivered");
  const done = sorted.filter((o) => o.status === "delivered");

  const card = (o: OpenSeatOrder) => (
    <li key={o.orderId} className="rounded-lg border-2 p-3" style={{ borderColor: o.status === "new" ? "var(--accent)" : "var(--border)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 break-words font-display text-xl">{boardLabel(o.spotName)}</span>
        <span className="shrink-0 text-xs font-semibold" style={{ color: "var(--foreground)" }}>
          #{o.orderNumber} · {o.status === "delivered" ? "delivered" : waitingFor(o.createdAt)}
        </span>
      </div>
      {(o.guestName || o.note) && <div className="text-sm font-semibold" style={{ color: "var(--accent)" }}>{[o.guestName, o.note].filter(Boolean).join(" · ")}</div>}
      {o.idCheck && <div className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-black" style={{ background: "var(--foreground)", color: "var(--background)" }}>ID CHECK ON DELIVERY</div>}
      <ul className="mt-1 text-sm">
        {o.items.map((i, n) => (
          <li key={n}>
            {i.quantity > 1 ? `${i.quantity}× ` : ""}
            {i.name}
            {i.modifiers.length > 0 && <span style={{ color: "var(--muted)" }}> · {i.modifiers.join(", ")}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["making", "delivered"] as const).map((s) => {
          const on = o.status === s || (s === "making" && o.status === "delivered");
          return (
            <button
              key={s}
              className="min-h-11 rounded-lg border-2 text-sm font-bold"
              style={on ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" } : { borderColor: "var(--foreground)" }}
              aria-pressed={on}
              onClick={() => {
                if (!on) void step(o, s);
              }}
            >
              {on ? "✓ " : ""}
              {s === "making" ? "Making" : "Delivered"}
            </button>
          );
        })}
      </div>
      {undo?.orderId === o.orderId && (
        <button
          className="mt-2 min-h-11 w-full rounded-lg border-2 text-sm font-bold"
          style={{ borderColor: "var(--border)" }}
          onClick={() => {
            const back = undo.before;
            if (undoTimer.current) clearTimeout(undoTimer.current);
            setUndo(null);
            void step(o, back, false);
          }}
        >
          Undo ({o.status === "delivered" ? "Delivered" : "Making"})
        </button>
      )}
      {failed.has(o.orderId) && (
        <p className="mt-2 text-sm font-bold" role="alert" style={{ color: "var(--danger-text)" }}>
          Didn&apos;t save — tap again
        </p>
      )}
    </li>
  );

  return (
    <>
      <button
        className={`chip relative min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm font-bold ${fresh ? "motion-safe:animate-checkin-pulse" : ""}`}
        style={fresh ? { borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-foreground)" } : { borderColor: "var(--foreground)" }}
        onClick={openList}
        aria-label={fresh ? `Order up: ${fresh} new phone order${fresh === 1 ? "" : "s"}` : `Phone orders: ${waiting} waiting`}
      >
        {fresh ? "Order up" : "Phone orders"}
        <CountBadge n={fresh || waiting} className="absolute -right-2 -top-2" />
      </button>
      {alerting.length > 0 && !open && (
        <button
          className="order-last flex min-h-11 basis-full items-center gap-3 rounded-lg border-2 px-3 py-1.5 text-left font-bold"
          style={{ borderColor: "var(--foreground)", background: "var(--accent)", color: "var(--accent-foreground)" }}
          onClick={openList}
          role="alert"
        >
          <span className="shrink-0 font-display text-lg">Order up!</span>
          <span className="min-w-0 flex-1 truncate text-sm">
            {alerting.length > 1 ? `${alerting.length} new phone orders` : first ? boardLabel(first.spotName) : "New phone order"}
          </span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(0,0,0,0.22)" }}>
            {soundOff ? "Tap for sound" : "Tap to see"}
          </span>
        </button>
      )}
      {alerting.length > 0 && !open && covered && (
        // Above a payment or other register screen: a slim strip. A tap
        // stops the sound for now (seen); the list opens from Order up once
        // the sale is done.
        <button
          className="fixed inset-x-0 top-0 z-[55] flex min-h-11 items-center gap-3 border-b-2 px-4 py-1.5 text-left font-bold shadow-lg"
          style={{ borderColor: "var(--foreground)", background: "var(--accent)", color: "var(--accent-foreground)" }}
          onClick={() => markSeen(alerting.map((o) => o.orderId))}
          role="alert"
        >
          <span className="shrink-0 font-display text-lg">Order up!</span>
          <span className="min-w-0 flex-1 truncate text-sm">
            {alerting.length > 1 ? `${alerting.length} new phone orders` : first ? boardLabel(first.spotName) : "New phone order"} · open Order up after this
          </span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(0,0,0,0.22)" }}>
            {soundOff ? "Tap for sound" : "Got it"}
          </span>
        </button>
      )}
      {open && (
        <Dialog title="Order up" onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Orders from guests&apos; phones. Seat ordering: {data.label} · turn it on or off in Staff.
          </p>
          {loadFailed && (
            <p className="mb-3 text-sm font-bold" role="alert" style={{ color: "var(--danger-text)" }}>
              Can&apos;t check for phone orders right now. This list may be out of date; it keeps trying.
            </p>
          )}
          {data.orders.length === 0 ? (
            <p className="text-sm">Nothing waiting.</p>
          ) : (
            <>
              {active.length === 0 ? <p className="text-sm">Nothing waiting.</p> : <ul className="space-y-3">{active.map(card)}</ul>}
              {done.length > 0 && (
                <details className="mt-4">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Delivered ({done.length})</summary>
                  <ul className="mt-2 space-y-3">{done.map(card)}</ul>
                </details>
              )}
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

// The Staff panel's "Seat ordering: on/off". Only shown once it's been
// switched on in Back office (so a short-handed night can switch it off);
// while it's off the Staff panel looks the same as without it.
export function SeatOrderingSwitch() {
  const { data, load, setData } = useSeatOrders();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  // Turning it on takes a manager (code review N22): a manager PIN unless a
  // manager is signed in. Off needs nobody.
  const [askPin, setAskPin] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Stays up once seen on, so switching it off doesn't hide the switch.
  if (data?.enabled && !shown) setShown(true);
  if (!data || !shown) return null;
  async function flip() {
    if (!data) return;
    setBusy(true);
    setProblem(null);
    const next = !data.enabled;
    const r = await setSeatOrderingOn(next).catch(() => null);
    if (r?.needPin) setAskPin(true);
    else if (!r?.ok) setProblem(r?.error ?? "Didn't save. Try again.");
    else setData({ ...data, enabled: next });
    await load();
    setBusy(false);
  }
  return (
    <section aria-label="Seat ordering">
      <div className="eyebrow mb-2">Seat ordering</div>
      <button
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border-2 px-4 text-left"
        style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}
        role="switch"
        aria-checked={data.enabled}
        disabled={busy}
        onClick={() => void flip()}
      >
        <span className="min-w-0">
          <span className="block font-bold">Seat ordering: {data.enabled ? "on" : "off"}</span>
          <span className="block text-xs" style={{ color: "var(--muted)" }}>
            {data.enabled ? `${data.label}. Turn it off on a short-handed night.` : "Guests see “paused, please order at the counter”. Turning it on takes a manager."}
          </span>
        </span>
        <span className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: data.enabled ? "var(--success-text)" : "var(--border)" }} aria-hidden>
          <span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: data.enabled ? 26 : 4 }} />
        </span>
      </button>
      {problem && (
        <p className="mt-2 text-sm font-bold" role="alert" style={{ color: "var(--danger-text)" }}>
          {problem}
        </p>
      )}
      {askPin && (
        <ManagerPinModal
          title="Manager PIN"
          description="Turn seat ordering on? Guests can order from their seats until it's turned off."
          onCancel={() => setAskPin(false)}
          onSubmit={async (pin) => {
            const r = await setSeatOrderingOn(true, pin);
            if (!r.ok) throw new Error(r.error ?? "That didn't work. Try again.");
            setAskPin(false);
            await load();
          }}
        />
      )}
    </section>
  );
}
