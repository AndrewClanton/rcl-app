"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KitchenTicket } from "@/lib/data/kitchen";

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

export default function KitchenDisplay({ initialTickets }: { initialTickets: KitchenTicket[] }) {
  const [tickets, setTickets] = useState(initialTickets);
  const [connected, setConnected] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // The realtime socket authenticates using whatever session the client
    // currently has. Right after mount, the browser client is still
    // hydrating its session from cookies -- subscribing before that
    // resolves connects as anonymous, and RLS then silently drops every
    // row (the channel still reports SUBSCRIBED; it just receives
    // nothing). Waiting for getSession() first avoids that race.
    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel("kitchen-order-items")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "order_items" },
          async (payload) => {
            const row = payload.new as { id: string; order_id: string; name: string; quantity: number; modifiers: string[]; created_at: string; is_event: boolean };
            if (row.is_event) return;
            const { data: order } = await supabase.from("orders").select("order_number, order_name, status").eq("id", row.order_id).single();
            if (!order || order.status !== "completed") return;
            setTickets((prev) =>
              [
                {
                  id: row.id,
                  order_id: row.order_id,
                  name: row.name,
                  quantity: row.quantity,
                  modifiers: row.modifiers,
                  created_at: row.created_at,
                  order_number: order.order_number,
                  order_name: order.order_name,
                },
                ...prev,
              ].slice(0, 60)
            );
          }
        )
        .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    });

    // Re-render periodically so "time ago" labels stay fresh.
    const interval = setInterval(() => forceTick((t) => t + 1), 15000);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const grouped = new Map<number, KitchenTicket[]>();
  for (const t of tickets) {
    const list = grouped.get(t.order_number) ?? [];
    list.push(t);
    grouped.set(t.order_number, list);
  }

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="mb-6 flex items-center justify-between border-b-2 pb-4" style={{ borderColor: "var(--foreground)" }}>
        <h1 className="font-display text-2xl">Kitchen</h1>
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
          {[...grouped.entries()].map(([orderNumber, items]) => (
            <div key={orderNumber} className="card">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-display text-lg">#{orderNumber}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {timeAgo(items[0].created_at)}
                </span>
              </div>
              {items[0].order_name && (
                <div className="mb-2 text-sm" style={{ color: "var(--muted)" }}>
                  {items[0].order_name}
                </div>
              )}
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="text-sm">
                    <span className="font-medium">
                      {item.quantity > 1 ? `${item.quantity}× ` : ""}
                      {item.name}
                    </span>
                    {item.modifiers.length > 0 && (
                      <div className="text-xs" style={{ color: "var(--muted)" }}>
                        {item.modifiers.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
