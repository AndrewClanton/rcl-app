"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PRIVATE_CHANNEL, subscribePrivate } from "@/lib/supabase/realtime";
import type { Board, PrepTicket } from "@/lib/data/prepTickets";
import { reprintOrderTicket, setItemReady } from "./actions";

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

// How long after the last change the board reloads its tickets. A sale or a
// tab save arrives as a burst (the order, then its lines; a tab save today
// puts every line in again and takes the old rows out), and this takes the
// whole burst in one reload.
const RELOAD_AFTER_MS = 400;

// Shared by /display/kitchen, /display/bar and /display/prep (both at once)
// -- same board, filtered to a prep station or not. Paid orders and open
// tabs, live from Supabase (order_items inserts, updates and deletes, and
// order changes), and interactive: tapping an item marks it ready, which
// every other tablet watching sees too.
export default function PrepTicketBoard({ title, station, initialTickets }: { title: string; station: Board; initialTickets: PrepTicket[] }) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initialTickets);
  // A reload (router.refresh() below) re-renders the page on the server,
  // which hands in a fresh list: that replaces what's on screen.
  const [loaded, setLoaded] = useState(initialTickets);
  if (initialTickets !== loaded) {
    setLoaded(initialTickets);
    setTickets(initialTickets);
  }
  const [connected, setConnected] = useState(false);
  const [, forceTick] = useState(0);
  // "Reprint ticket" on a card: which order is printing, and how it went.
  const [reprinting, setReprinting] = useState<number | null>(null);
  const [reprinted, setReprinted] = useState<{ orderNumber: number; ok: boolean; text: string } | null>(null);

  async function reprint(orderNumber: number, orderId: string) {
    setReprinting(orderNumber);
    setReprinted(null);
    const r = await reprintOrderTicket(orderId).catch(() => null);
    setReprinting(null);
    const note = !r ? { ok: false, text: "Couldn't reach the website. Try again." } : r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error };
    setReprinted({ orderNumber, ...note });
    setTimeout(() => setReprinted((cur) => (cur?.orderNumber === orderNumber ? null : cur)), 8000);
  }

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Which station a new line goes to, its order and whether it's a tab
    // add-on are worked out on the server (lib/data/prepTickets.ts), so a
    // change reloads the page's tickets rather than guessing here.
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), RELOAD_AFTER_MS);
    };

    const channel = supabase
      .channel(`prep-tickets-${station}`, PRIVATE_CHANNEL)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_items" }, (payload) => {
        // Movie tickets never show here.
        if (!(payload.new as { is_event?: boolean }).is_event) reload();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "order_items" }, (payload) => {
        // Marked ready (here or on another screen), or the line was changed.
        const row = payload.new as Pick<PrepTicket, "id" | "name" | "quantity" | "modifiers" | "ready" | "ready_at">;
        setTickets((prev) =>
          prev.some((t) => t.id === row.id)
            ? prev.map((t) =>
                t.id === row.id ? { ...t, name: row.name, quantity: row.quantity, modifiers: row.modifiers ?? [], ready: row.ready, ready_at: row.ready_at } : t
              )
            : prev
        );
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "order_items" }, (payload) => {
        // A line taken off a tab, or a cancelled tab. A delete carries only
        // the row's id. The reload fills the space it leaves.
        const id = (payload.old as { id?: string }).id;
        if (!id) return;
        setTickets((prev) => prev.filter((t) => t.id !== id));
        reload();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => {
        // A tab renamed or paid, or a sale refunded or voided: its card
        // changes or leaves.
        reload();
      });
    const leave = subscribePrivate(supabase, channel, (status) => {
      setConnected(status === "SUBSCRIBED");
      // Joined, or back after a dropped connection: catch up on anything
      // that changed while this screen wasn't listening.
      if (status === "SUBSCRIBED") reload();
    });

    const interval = setInterval(() => forceTick((t) => t + 1), 15000);

    return () => {
      leave();
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [station, router]);

  function toggleReady(item: PrepTicket) {
    const next = !item.ready;
    setTickets((prev) => prev.map((t) => (t.id === item.id ? { ...t, ready: next, ready_at: next ? new Date().toISOString() : null } : t)));
    setItemReady(item.id, next).catch(() => {
      setTickets((prev) => prev.map((t) => (t.id === item.id ? { ...t, ready: item.ready, ready_at: item.ready_at } : t)));
    });
  }

  const grouped = new Map<number, PrepTicket[]>();
  for (const t of tickets) {
    const list = grouped.get(t.order_number) ?? [];
    list.push(t);
    grouped.set(t.order_number, list);
  }

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="mb-6 flex items-center justify-between border-b-2 pb-4" style={{ borderColor: "var(--foreground)" }}>
        <h1 className="font-display text-2xl">{title}</h1>
        <span className="flex items-center gap-2 text-sm font-bold" style={{ color: connected ? "var(--success-text)" : "var(--muted)" }}>
          <span className="h-2 w-2 rounded-full" style={{ background: connected ? "var(--success-text)" : "var(--muted)" }} />
          {connected ? "Live" : "Connecting..."}
        </span>
      </div>

      {grouped.size === 0 ? (
        <div className="mt-20 text-center" style={{ color: "var(--muted)" }}>
          No orders in the last two hours.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...grouped.entries()].map(([orderNumber, items]) => {
            const allReady = items.every((i) => i.ready);
            return (
              <div key={orderNumber} className="card" style={allReady ? { opacity: 0.55 } : undefined}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-display text-lg">#{orderNumber}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {timeAgo(items[0].created_at)}
                  </span>
                </div>
                {(items[0].tab || items[0].order_name) && (
                  <div className="mb-2 text-sm font-semibold" style={{ color: "var(--accent)" }}>
                    {items[0].tab ? (items[0].order_name ? `Tab: ${items[0].order_name}` : "Tab") : items[0].order_name}
                  </div>
                )}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    className="chip !px-3 !py-1 text-xs font-bold"
                    disabled={reprinting === orderNumber}
                    onClick={() => void reprint(orderNumber, items[0].order_id)}
                  >
                    {reprinting === orderNumber ? "Sending…" : "Reprint ticket"}
                  </button>
                  {reprinted?.orderNumber === orderNumber && (
                    <span className="text-xs font-semibold" style={{ color: reprinted.ok ? "var(--success-text)" : "var(--danger-text)" }} role="status">
                      {reprinted.text}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleReady(item)}
                      className="flex w-full items-start justify-between gap-2 rounded-lg border p-2 text-left transition-colors"
                      style={{
                        borderColor: item.ready ? "var(--success-border)" : "var(--border)",
                        background: item.ready ? "var(--success-bg)" : "transparent",
                      }}
                    >
                      <div className="min-w-0">
                        {station === "all" && (
                          <span
                            className="mr-1.5 rounded px-1 py-px align-middle text-[10px] font-bold uppercase tracking-wide"
                            style={item.station === "bar" ? { background: "var(--gold)", color: "var(--gold-foreground)" } : { background: "var(--foreground)", color: "var(--background)" }}
                          >
                            {item.station === "bar" ? "Bar" : "Kitchen"}
                          </span>
                        )}
                        {item.add_on && (
                          <span
                            className="mr-1.5 rounded px-1 py-px align-middle text-[10px] font-bold uppercase tracking-wide"
                            style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                          >
                            Add-on
                          </span>
                        )}
                        <span className="text-sm font-medium" style={item.ready ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                          {item.quantity > 1 ? `${item.quantity}× ` : ""}
                          {item.name}
                        </span>
                        {item.modifiers.length > 0 && (
                          <div className="text-xs" style={{ color: "var(--muted)" }}>
                            {item.modifiers.join(", ")}
                          </div>
                        )}
                      </div>
                      <span
                        className="shrink-0 rounded-full border-2 text-xs font-bold"
                        style={{
                          width: 22,
                          height: 22,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderColor: item.ready ? "var(--success-text)" : "var(--border)",
                          color: "var(--success-text)",
                        }}
                      >
                        {item.ready ? "✓" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
