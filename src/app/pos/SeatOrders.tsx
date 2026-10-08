"use client";

import { useCallback, useEffect, useState } from "react";
import { CountBadge, Dialog } from "./shift/ui";
import { getRegisterSeatOrders, setRegisterSeatStatus, setSeatOrderingOn, type RegisterSeatOrders } from "./seat-order-actions";
import { boardLabel, type SeatStatus } from "@/lib/seat-ordering";
import type { OpenSeatOrder } from "@/lib/seat-ordering-server";
import { playSeatChime, unlockChime } from "../display/seat-chime";

// Orders from guests' phones, on the register (lib/seat-ordering.ts): an
// "Order up" button and banner beside Staff and the list behind it, with Making
// and Delivered (the boards have the same buttons). Self-contained: it asks
// the server every 15 seconds while seat ordering is on (or something's
// waiting), once a minute while it's off, and draws nothing while it's off
// and nothing's waiting, so the register looks the same as without it.

const POLL_MS = 15_000;
const IDLE_POLL_MS = 60_000;

function useSeatOrders() {
  const [data, setData] = useState<RegisterSeatOrders | null>(null);
  const load = useCallback(async () => {
    const r = await getRegisterSeatOrders().catch(() => null);
    if (r) setData(r);
    return r;
  }, []);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stop) return;
      const r = document.visibilityState === "visible" ? await load() : null;
      if (stop) return;
      const active = !!r && (r.enabled || r.orders.length > 0);
      timer = setTimeout(() => void tick(), active ? POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);
  return { data, load, setData };
}

function waitingFor(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just in" : `waiting ${m} min`;
}

// How often the chime repeats until someone taps "Order up".
const CHIME_REPEAT_MS = 20_000;

// "Order up": the button beside Staff, plus, when a new paid order comes in
// while seat ordering is on, a banner at the top of the register and a
// chime that repeats every 20 seconds until someone taps the banner or the
// button (either opens the list). The banner is small and sits over the
// header, so ringing up a sale carries on underneath it. iPad Safari keeps
// sound off until the page is tapped, so the first tap anywhere on the
// register unlocks it.
export function SeatOrdersButton() {
  const { data, load, setData } = useSeatOrders();
  const [open, setOpen] = useState(false);
  const [acked, setAcked] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const unlock = () => unlockChime();
    document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    document.addEventListener("keydown", unlock, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);

  const freshIds = (data?.orders ?? []).filter((o) => o.status === "new").map((o) => o.orderId);
  const unacked = data?.enabled ? freshIds.filter((id) => !acked.has(id)) : [];
  const alertKey = unacked.join(",");

  useEffect(() => {
    if (!alertKey) return;
    playSeatChime();
    const t = setInterval(playSeatChime, CHIME_REPEAT_MS);
    return () => clearInterval(t);
  }, [alertKey]);

  function openList() {
    if (freshIds.length) setAcked((a) => new Set([...a, ...freshIds]));
    setOpen(true);
  }

  if (!data || (!data.enabled && data.orders.length === 0)) return null;
  const fresh = freshIds.length;
  const waiting = data.orders.filter((o) => o.status !== "delivered").length;
  const firstNew = data.orders.find((o) => o.orderId === unacked[0]);

  async function step(o: OpenSeatOrder, status: SeatStatus) {
    const before = o.status;
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
    await load();
  }

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
      {unacked.length > 0 && !open && (
        <button
          className="fixed left-1/2 top-2 z-40 flex min-h-14 max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border-2 px-5 py-2 text-left font-bold shadow-2xl"
          style={{ borderColor: "var(--foreground)", background: "var(--accent)", color: "var(--accent-foreground)" }}
          onClick={openList}
          role="alert"
        >
          <span className="shrink-0 font-display text-xl">Order up!</span>
          <span className="min-w-0 truncate text-sm">
            {unacked.length > 1
              ? `${unacked.length} new phone orders`
              : firstNew
                ? [boardLabel(firstNew.spotName), firstNew.guestName].filter(Boolean).join(" · ")
                : "New phone order"}
          </span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(0,0,0,0.22)" }}>
            Tap to see
          </span>
        </button>
      )}
      {open && (
        <Dialog title="Order up" onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Orders from guests&apos; phones. Seat ordering: {data.label}. Switch it in Staff.
          </p>
          {data.orders.length === 0 ? (
            <p className="text-sm">Nothing waiting.</p>
          ) : (
            <ul className="space-y-3">
              {data.orders.map((o) => (
                <li key={o.orderId} className="rounded-lg border-2 p-3" style={{ borderColor: o.status === "new" ? "var(--accent)" : "var(--border)", opacity: o.status === "delivered" ? 0.55 : 1 }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-display text-xl">{boardLabel(o.spotName)}</span>
                    <span className="shrink-0 text-xs font-semibold" style={{ color: o.status === "delivered" ? "var(--muted)" : "var(--foreground)" }}>
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
                      const on = o.status === s;
                      return (
                        <button
                          key={s}
                          className="min-h-11 rounded-lg border-2 text-sm font-bold"
                          style={on ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" } : { borderColor: "var(--foreground)" }}
                          aria-pressed={on}
                          onClick={() => void step(o, on ? (s === "delivered" ? "making" : "new") : s)}
                        >
                          {on ? "✓ " : ""}
                          {s === "making" ? "Making" : "Delivered"}
                        </button>
                      );
                    })}
                  </div>
                  {failed.has(o.orderId) && (
                    <p className="mt-2 text-sm font-bold" role="alert" style={{ color: "var(--danger-text)" }}>
                      Didn&apos;t save — tap again
                    </p>
                  )}
                </li>
              ))}
            </ul>
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
  // Stays up once seen on, so switching it off doesn't hide the switch.
  if (data?.enabled && !shown) setShown(true);
  if (!data || !shown) return null;
  async function flip() {
    if (!data) return;
    setBusy(true);
    const next = !data.enabled;
    setData({ ...data, enabled: next });
    await setSeatOrderingOn(next).catch(() => null);
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
            {data.enabled ? `${data.label}. Turn it off on a short-handed night.` : "Guests see “paused, please order at the box office”."}
          </span>
        </span>
        <span className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: data.enabled ? "var(--success-text)" : "var(--border)" }} aria-hidden>
          <span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: data.enabled ? 26 : 4 }} />
        </span>
      </button>
    </section>
  );
}
