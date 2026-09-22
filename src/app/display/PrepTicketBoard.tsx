"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PrepTicket, Station } from "@/lib/data/prepTickets";
import { setItemReady } from "./actions";

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

// Shared by /display/kitchen and /display/bar -- same board, filtered to a
// different prep station. Real-time via Supabase (order_items INSERT/UPDATE),
// and interactive: tapping an item marks it ready, which also broadcasts to
// every other tablet watching the same board (another kitchen screen, or
// the customer-facing display if it's ever extended to show prep status).
export default function PrepTicketBoard({ title, station, initialTickets }: { title: string; station: Station; initialTickets: PrepTicket[] }) {
  const [tickets, setTickets] = useState(initialTickets);
  const [connected, setConnected] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // Wait for the browser client's own session to hydrate before
    // subscribing -- subscribing first connects as anonymous and RLS
    // silently drops every row (channel still reports SUBSCRIBED).
    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`prep-tickets-${station}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "order_items" },
          async (payload) => {
            const row = payload.new as {
              id: string;
              order_id: string;
              name: string;
              quantity: number;
              modifiers: string[];
              ready: boolean;
              ready_at: string | null;
              created_at: string;
              is_event: boolean;
              is_alcohol: boolean;
              menu_item_id: string | null;
            };
            if (row.is_event) return;
            const [{ data: order }, categoryKey] = await Promise.all([
              supabase.from("orders").select("order_number, order_name, status").eq("id", row.order_id).single(),
              row.menu_item_id
                ? supabase
                    .from("menu_items")
                    .select("category:menu_categories(key)")
                    .eq("id", row.menu_item_id)
                    .single()
                    .then((res) => (res.data?.category as unknown as { key: string } | null)?.key ?? null)
                : Promise.resolve(null),
            ]);
            if (!order || order.status !== "completed") return;

            const rowStation: Station | null = categoryKey
              ? KITCHEN_CATEGORIES.has(categoryKey)
                ? "kitchen"
                : BAR_CATEGORIES.has(categoryKey)
                  ? "bar"
                  : null
              : row.is_alcohol
                ? "bar"
                : "kitchen";
            if (rowStation !== station) return;

            setTickets((prev) =>
              [
                {
                  id: row.id,
                  order_id: row.order_id,
                  name: row.name,
                  quantity: row.quantity,
                  modifiers: row.modifiers,
                  ready: row.ready,
                  ready_at: row.ready_at,
                  created_at: row.created_at,
                  order_number: order.order_number,
                  order_name: order.order_name,
                },
                ...prev,
              ].slice(0, 60)
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "order_items" },
          (payload) => {
            const row = payload.new as { id: string; ready: boolean; ready_at: string | null };
            setTickets((prev) => prev.map((t) => (t.id === row.id ? { ...t, ready: row.ready, ready_at: row.ready_at } : t)));
          }
        )
        .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    });

    const interval = setInterval(() => forceTick((t) => t + 1), 15000);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [station]);

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
                {items[0].order_name && (
                  <div className="mb-2 text-sm font-semibold" style={{ color: "var(--accent)" }}>
                    {items[0].order_name}
                  </div>
                )}
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

const KITCHEN_CATEGORIES = new Set(["grub"]);
const BAR_CATEGORIES = new Set(["beer", "wine", "cocktails", "shots", "spirits", "caffe", "rad"]);
