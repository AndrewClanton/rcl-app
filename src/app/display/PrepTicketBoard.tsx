"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Board, PrepTicket, Station } from "@/lib/data/prepTickets";
import { reprintOrderTicket, setItemReady } from "./actions";
import DrinkIcon from "@/components/bar/DrinkIcon";
import { FAMILY_COLOR } from "@/lib/bar/icons";
import { boardEntryFor, type BoardEntry } from "@/lib/bar/book";

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

// Shared by /display/kitchen, /display/bar and /display/prep (both at once)
// -- same board, filtered to a prep station or not. Real-time via Supabase (order_items INSERT/UPDATE),
// and interactive: tapping an item marks it ready, which also broadcasts to
// every other tablet watching the same board (another kitchen screen, or
// the customer-facing display if it's ever extended to show prep status).
//
// The bar and both-at-once boards also get `drinks`: each alcohol menu
// item's drink icon and recipe card, read once when the page loads. A line
// with one shows its icon, and a Recipe button when it has a recipe; a line
// without (coffee, sodas, a custom line, an item added since the page
// loaded) looks exactly as it always did. The kitchen board gets none.
export default function PrepTicketBoard({
  title,
  station,
  initialTickets,
  drinks,
}: {
  title: string;
  station: Board;
  initialTickets: PrepTicket[];
  drinks?: Record<string, BoardEntry>;
}) {
  const [tickets, setTickets] = useState(initialTickets);
  // The recipe open on screen, if any.
  const [recipe, setRecipe] = useState<{ name: string; entry: BoardEntry } | null>(null);
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
            if (!rowStation || (station !== "all" && rowStation !== station)) return;

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
                  station: rowStation,
                  menu_item_id: row.menu_item_id ?? null,
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
                  {items.map((item) => {
                    const drink = boardEntryFor(drinks, item.menu_item_id);
                    // Name and choices, as they've always been.
                    const text = (
                      <>
                        {station === "all" && (
                          <span
                            className="mr-1.5 rounded px-1 py-px align-middle text-[10px] font-bold uppercase tracking-wide"
                            style={item.station === "bar" ? { background: "var(--gold)", color: "var(--gold-foreground)" } : { background: "var(--foreground)", color: "var(--background)" }}
                          >
                            {item.station === "bar" ? "Bar" : "Kitchen"}
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
                      </>
                    );
                    const line = (
                    <button
                      key={item.id}
                      onClick={() => toggleReady(item)}
                      className={`flex w-full items-start justify-between gap-2 rounded-lg border p-2 text-left transition-colors${drink ? " min-w-0 flex-1" : ""}`}
                      style={{
                        borderColor: item.ready ? "var(--success-border)" : "var(--border)",
                        background: item.ready ? "var(--success-bg)" : "transparent",
                      }}
                    >
                      {drink ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span style={{ color: "var(--foreground)", opacity: item.ready ? 0.5 : 1 }}>
                            <DrinkIcon spec={drink.spec} size={40} />
                          </span>
                          <div className="min-w-0">{text}</div>
                        </div>
                      ) : (
                        <div className="min-w-0">{text}</div>
                      )}
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
                    );
                    if (!drink) return line;
                    // The line marks it ready; Recipe, beside it, only opens the card.
                    return (
                      <div key={item.id} className="flex items-stretch gap-2">
                        {line}
                        {drink.card && (
                          <button
                            className="min-h-11 shrink-0 rounded-lg border-2 px-3 text-sm font-bold"
                            style={{ borderColor: "var(--foreground)", color: "var(--foreground)", background: "var(--surface)" }}
                            onClick={() => setRecipe({ name: item.name, entry: drink })}
                          >
                            Recipe
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recipe && <RecipeOverlay name={recipe.name} entry={recipe.entry} onClose={() => setRecipe(null)} />}
    </div>
  );
}

// A drink's recipe, big enough to read from arm's length while making it.
function RecipeOverlay({ name, entry, onClose }: { name: string; entry: BoardEntry; onClose: () => void }) {
  const card = entry.card;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!card) return null;
  const facts = [card.method, card.glass, card.garnish ? `Garnish: ${card.garnish}` : null].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="card flex max-h-[92vh] w-full max-w-4xl flex-col gap-5 overflow-y-auto shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} recipe`}
        onClick={(e) => e.stopPropagation()}
        style={{ color: "var(--foreground)" }}
      >
        <div className="flex items-start gap-6">
          <span className="shrink-0" style={{ color: "var(--foreground)" }}>
            <DrinkIcon spec={entry.spec} size={160} label={name} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-4xl leading-tight">{name}</h2>
            {facts && <p className="mt-2 text-xl" style={{ color: "var(--muted)" }}>{facts}</p>}
          </div>
        </div>
        {card.lines.length > 0 && (
          <ul className="space-y-1">
            {card.lines.map((l, i) => (
              <li key={i} className="flex items-center gap-3 border-b py-2 text-2xl" style={{ borderColor: "var(--border)" }}>
                <span className="h-5 w-5 shrink-0 rounded" style={{ background: l.family ? FAMILY_COLOR[l.family] : "var(--border)" }} aria-hidden />
                <span className="min-w-0 flex-1">
                  {l.name}
                  {l.optional && <span className="ml-2 text-lg" style={{ color: "var(--muted)" }}>optional</span>}
                </span>
                <span className="shrink-0 font-bold tabular-nums">{l.amount}</span>
              </li>
            ))}
          </ul>
        )}
        {card.instructions && <p className="text-2xl leading-snug">{card.instructions}</p>}
        <button className="btn-primary min-h-16 w-full !text-2xl" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

const KITCHEN_CATEGORIES = new Set(["grub"]);
const BAR_CATEGORIES = new Set(["beer", "wine", "cocktails", "shots", "spirits", "caffe", "rad"]);
