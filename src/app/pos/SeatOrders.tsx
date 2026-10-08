"use client";

import { useCallback, useEffect, useState } from "react";
import { CountBadge, Dialog } from "./shift/ui";
import { getRegisterSeatOrders, setRegisterSeatStatus, setSeatOrderingOn, type RegisterSeatOrders } from "./seat-order-actions";
import { boardLabel, type SeatStatus } from "@/lib/seat-ordering";
import type { OpenSeatOrder } from "@/lib/seat-ordering-server";

// Orders from guests' phones, on the register (lib/seat-ordering.ts): a
// "New seat order" badge beside Staff and the list behind it, with Making
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

function ago(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : `${m} min ago`;
}

export function SeatOrdersButton() {
  const { data, load, setData } = useSeatOrders();
  const [open, setOpen] = useState(false);
  if (!data || (!data.enabled && data.orders.length === 0)) return null;
  const fresh = data.orders.filter((o) => o.status === "new").length;
  const waiting = data.orders.filter((o) => o.status !== "delivered").length;

  async function step(o: OpenSeatOrder, status: SeatStatus) {
    setData((d) => (d ? { ...d, orders: d.orders.map((x) => (x.orderId === o.orderId ? { ...x, status } : x)) } : d));
    await setRegisterSeatStatus(o.orderId, status).catch(() => false);
    await load();
  }

  return (
    <>
      <button
        className={`chip relative min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm font-bold ${fresh ? "motion-safe:animate-checkin-pulse" : ""}`}
        style={fresh ? { borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-foreground)" } : { borderColor: "var(--foreground)" }}
        onClick={() => setOpen(true)}
        aria-label={fresh ? `${fresh} new seat order${fresh === 1 ? "" : "s"}` : `Seat orders: ${waiting} waiting`}
      >
        {fresh ? "New seat order" : "Seats"}
        <CountBadge n={fresh || waiting} className="absolute -right-2 -top-2" />
      </button>
      {open && (
        <Dialog title="Seat orders" onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Seat ordering: {data.label}. Switch it in Staff.
          </p>
          {data.orders.length === 0 ? (
            <p className="text-sm">Nothing waiting.</p>
          ) : (
            <ul className="space-y-3">
              {data.orders.map((o) => (
                <li key={o.orderId} className="rounded-lg border-2 p-3" style={{ borderColor: o.status === "new" ? "var(--accent)" : "var(--border)", opacity: o.status === "delivered" ? 0.55 : 1 }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-xl">{boardLabel(o.spotName)}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      #{o.orderNumber} · {ago(o.createdAt)}
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
