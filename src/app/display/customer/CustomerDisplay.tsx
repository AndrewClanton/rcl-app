"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { RegisterCartSnapshot } from "@/lib/registerChannel";
import CheckinKiosk from "./CheckinKiosk";
import Streamers, { makeStreamers, type StreamerPiece } from "./Streamers";

interface PromoMovie {
  title: string;
  posterUrl: string | null;
  nextShowtime: string;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function fmtShowtime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// The tablet at the point of service: a promotional idle screen (this
// week's lineup) when nothing's being rung up, switching automatically to
// a live mirror of the order as the cashier builds it (see PosApp.tsx,
// which broadcasts cart snapshots -- not database-backed, since an
// in-progress cart isn't saved anywhere until held/tabbed/completed).
// "Check in for points" (CheckinKiosk.tsx) puts today's sale on a
// customer's account by phone number, confirmed by staff at the register,
// and plays the points burst when that sale completes.
// checkinFirst: with no order being rung up, the screen is the check-in
// keypad (everyone checks in at the door) instead of the movie posters.
export default function CustomerDisplay({ movies, registerTopic, checkinFirst = true }: { movies: PromoMovie[]; registerTopic: string; checkinFirst?: boolean }) {
  const [cart, setCart] = useState<RegisterCartSnapshot | null>(null);
  // The register's ✨ Celebrate: a burst of streamers, new each time.
  const [burst, setBurst] = useState<{ id: number; pieces: StreamerPiece[] } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(registerTopic)
        .on("broadcast", { event: "cart" }, (msg) => setCart(msg.payload as RegisterCartSnapshot))
        .on("broadcast", { event: "celebrate" }, () => setBurst({ id: Date.now(), pieces: makeStreamers() }))
        .subscribe((status) => {
          // A kiosk that just loaded (or refreshed) has missed every prior
          // broadcast -- ask the POS to resend its current state instead of
          // sitting blank until the cashier's next edit.
          if (status === "SUBSCRIBED") channel?.send({ type: "broadcast", event: "request-state", payload: {} });
        });
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [registerTopic]);

  const hasOrder = !!cart && cart.items.length > 0;
  const clearBurst = useCallback(() => setBurst(null), []);

  return (
    <div className="relative min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {hasOrder ? <OrderMirror cart={cart} /> : <PromoIdle movies={movies} />}
      <CheckinKiosk registerTopic={registerTopic} home={checkinFirst && !hasOrder} />
      {burst && <Streamers key={burst.id} pieces={burst.pieces} onDone={clearBurst} />}
    </div>
  );
}

// The live tally: every line with its price as it's rung up, any savings,
// the total, and (once they've checked in) whose order it is and the points
// it'll earn. Sized to read across the counter.
export function OrderMirror({ cart }: { cart: RegisterCartSnapshot }) {
  const who = cart.member;
  const earn = cart.pointsToEarn ?? 0;
  const count = cart.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6 pb-28 md:grid-cols-[1.35fr_1fr] md:items-start md:p-10">
      <section className="overflow-hidden rounded-lg border-[3px]" style={{ borderColor: "var(--foreground)", background: "var(--surface)", boxShadow: "6px 6px 0 var(--foreground)" }}>
        <header className="flex items-baseline justify-between gap-3 px-5 py-3" style={{ background: "var(--foreground)", color: "var(--gold)" }}>
          <h1 className="font-display text-2xl uppercase tracking-wide">{who ? `${who.firstName}'s order` : cart.orderName ? cart.orderName : "Your order"}</h1>
          <span className="font-mono text-sm opacity-80">
            {count} item{count === 1 ? "" : "s"}
          </span>
        </header>
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {cart.items.map((item, i) => (
            <li key={i} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-xl font-bold leading-snug">
                  {item.quantity > 1 && <span className="mr-1.5 font-mono text-lg">{item.quantity}×</span>}
                  {item.name}
                </div>
                {item.modifiers.length > 0 && <div className="mt-0.5 text-base text-[var(--muted)]">{item.modifiers.join(", ")}</div>}
              </div>
              {typeof item.lineTotal === "number" && <div className="shrink-0 font-mono text-xl tabular-nums">{money(item.lineTotal)}</div>}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5">
        <section className="rounded-lg border-[3px] p-5" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
          <div className="space-y-1.5 text-lg tabular-nums">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-mono">{money(cart.subtotal)}</span>
            </div>
            {(cart.discounts ?? []).map((d) => (
              <div key={d.label} className="flex justify-between font-bold" style={{ color: "var(--success-text)" }}>
                <span>{d.label}</span>
                <span className="font-mono">−{money(d.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between text-[var(--muted)]">
              <span>Tax</span>
              <span className="font-mono">{money(cart.tax)}</span>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t-[3px] pt-3" style={{ borderColor: "var(--foreground)" }}>
            <span className="font-display text-2xl uppercase">Total</span>
            <span className="font-display text-5xl tabular-nums" style={{ color: "var(--accent)" }}>
              {money(cart.total)}
            </span>
          </div>
        </section>

        {who ? (
          <section className="rounded-lg border-[3px] p-5" style={{ borderColor: "var(--foreground)", background: "var(--gold)", color: "var(--foreground)" }}>
            <div className="font-display text-xl uppercase tracking-wide">Hi {who.firstName}!</div>
            <div className="mt-1 text-lg">
              You have <b>{who.points.toLocaleString("en-US")} points</b>.
            </div>
            {earn > 0 && (
              <div className="font-display mt-2 text-3xl">
                +{earn} with this order
              </div>
            )}
          </section>
        ) : (
          earn > 0 && (
            <section className="rounded-lg border-[3px] border-dashed p-5 text-lg" style={{ borderColor: "var(--foreground)" }}>
              Not checked in? Tap <b>Check in for points</b> to earn <b>+{earn} points</b> on this order.
            </section>
          )
        )}
      </div>
    </div>
  );
}

function PromoIdle({ movies }: { movies: PromoMovie[] }) {
  return (
    <div className="p-8">
      <div className="mb-8 text-center">
        <div className="eyebrow mb-2">Royale Cinema Lounge</div>
        <h1 className="font-display text-3xl">Now Playing</h1>
      </div>
      {movies.length === 0 ? (
        <p className="text-center text-[var(--muted)]">Check with staff for what&apos;s playing.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {movies.map((m) => (
            <div key={m.title}>
              <div className="poster-frame">
                {m.posterUrl ? (
                  <Image src={m.posterUrl} alt={`${m.title} poster`} fill sizes="220px" className="object-cover" />
                ) : (
                  <div className="poster-placeholder">
                    <span className="line-clamp-2 text-[11px] font-medium leading-tight">{m.title}</span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 text-center text-sm font-medium">{m.title}</div>
              <div className="text-center text-xs text-[var(--muted)]">{fmtShowtime(m.nextShowtime)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
