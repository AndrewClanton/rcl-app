"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { PRIVATE_CHANNEL, realtimeReady } from "@/lib/supabase/realtime";
import type { RegisterCartSnapshot } from "@/lib/registerChannel";
import CheckinKiosk from "./CheckinKiosk";

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
export default function CustomerDisplay({ movies, registerTopic }: { movies: PromoMovie[]; registerTopic: string }) {
  const [cart, setCart] = useState<RegisterCartSnapshot | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    realtimeReady(supabase).then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(registerTopic, PRIVATE_CHANNEL)
        .on("broadcast", { event: "cart" }, (msg) => setCart(msg.payload as RegisterCartSnapshot))
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

  return (
    <div className="relative min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {hasOrder ? <OrderMirror cart={cart} /> : <PromoIdle movies={movies} />}
      <CheckinKiosk registerTopic={registerTopic} />
    </div>
  );
}

function OrderMirror({ cart }: { cart: RegisterCartSnapshot }) {
  return (
    <div className="mx-auto max-w-xl p-8">
      <div className="eyebrow mb-2 text-center">Your order</div>
      {cart.orderName && <h1 className="font-display mb-6 text-center text-2xl">{cart.orderName}</h1>}
      <div className="space-y-3">
        {cart.items.map((item, i) => (
          <div key={i} className="card-flat flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                {item.quantity > 1 ? `${item.quantity}× ` : ""}
                {item.name}
              </div>
              {item.modifiers.length > 0 && <div className="text-sm text-[var(--muted)]">{item.modifiers.join(", ")}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-1 border-t-2 pt-4 text-lg" style={{ borderColor: "var(--foreground)" }}>
        <div className="flex justify-between text-sm text-[var(--muted)]">
          <span>Subtotal</span>
          <span>{money(cart.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-[var(--muted)]">
          <span>Tax</span>
          <span>{money(cart.tax)}</span>
        </div>
        <div className="flex justify-between font-display text-2xl">
          <span>Total</span>
          <span className="text-[var(--accent)]">{money(cart.total)}</span>
        </div>
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
