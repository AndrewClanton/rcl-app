"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { RegisterCartSnapshot } from "@/lib/registerChannel";
import { LADDER, REWARD_LABEL } from "@/lib/visits";
import CheckinKiosk, { type CheckinStep } from "./CheckinKiosk";
import Streamers, { makeStreamers, type StreamerPiece } from "./Streamers";
import k from "./kiosk.module.css";

export interface PromoMovie {
  title: string;
  posterUrl: string | null;
  nextShowtime: string;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function showtime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// The tablet facing the customer at the bar. Two halves:
// - left, always: the check-in keypad (CheckinKiosk.tsx), because everyone
//   checks in when they come through the door;
// - right: the live order as the bartender rings it up (PosApp.tsx
//   broadcasts cart snapshots; nothing is saved until the sale), or,
//   between orders, a Royale welcome: tonight's movies and the points path.
// The register's ✨ Celebrate throws streamers across the whole screen.
// previewCart / previewStep are for previews only.
export default function CustomerDisplay({
  movies,
  registerTopic,
  previewCart,
  previewStep,
}: {
  movies: PromoMovie[];
  registerTopic: string;
  previewCart?: RegisterCartSnapshot;
  previewStep?: CheckinStep;
}) {
  const [cart, setCart] = useState<RegisterCartSnapshot | null>(previewCart ?? null);
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
          // A screen that just loaded (or refreshed) has missed every prior
          // broadcast: ask the register to resend its current state.
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
    <div className={k.screen}>
      <CheckinKiosk registerTopic={registerTopic} initialStep={previewStep} />
      <aside className={k.side}>{hasOrder ? <OrderReceipt cart={cart} /> : <Welcome movies={movies} />}</aside>
      {burst && <Streamers key={burst.id} pieces={burst.pieces} onDone={clearBurst} />}
    </div>
  );
}

// Between orders: the Royale, tonight's movies, and why checking in pays.
function Welcome({ movies }: { movies: PromoMovie[] }) {
  return (
    <>
      <Image src="/photos/logo.png" alt="Royale Cinema Lounge" width={1436} height={492} className={k.logo} priority />
      <div className={k.sprockets} aria-hidden="true" />
      {movies.length > 0 && (
        <section>
          <div className={k.sectionHead}>
            <h2 className={k.h2}>Now showing</h2>
            <span className={k.eyebrow}>Tickets at the bar</span>
          </div>
          <div className={k.posters} style={{ marginTop: 12 }}>
            {movies.slice(0, 4).map((m) => (
              <div key={m.title} className={k.poster}>
                <div className={k.posterImg}>
                  {m.posterUrl ? (
                    <Image src={m.posterUrl} alt={`${m.title} poster`} fill sizes="220px" className="object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center p-3 text-center text-sm font-bold">{m.title}</div>
                  )}
                </div>
                <div className={k.posterTitle}>{m.title}</div>
                <span className={k.timeChip}>{showtime(m.nextShowtime)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className={k.pitch}>
        <div className={k.pitchTitle}>Check in every visit. Your streak pays.</div>
        <div className={k.ladder}>
          {LADDER.map((s) => (
            <div key={s.day} className={k.rung}>
              <div className={k.rungDay}>Day {s.day}</div>
              <div className={k.rungWhat}>{s.reward ? `${s.reward === "popcorn" ? "🍿" : "🍕"} ${REWARD_LABEL[s.reward]}` : `${s.points} pts`}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// The live tally on a cream receipt: every line with its price as it's
// rung up, any savings, the total, and (once they've checked in) whose order
// it is and the points it earns.
export function OrderReceipt({ cart }: { cart: RegisterCartSnapshot }) {
  const who = cart.member;
  const earn = cart.pointsToEarn ?? 0;
  const count = cart.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <div className={k.receipt}>
      <div className={k.receiptHead}>
        <span className={k.receiptName}>{who ? `${who.firstName}'s order` : cart.orderName || "Your order"}</span>
        <span className={k.eyebrow} style={{ color: "var(--gold)" }}>
          {count} item{count === 1 ? "" : "s"}
        </span>
      </div>
      <ul className={k.lines}>
        {cart.items.map((item, i) => (
          <li key={i} className={k.line}>
            <div style={{ minWidth: 0 }}>
              <div className={k.lineName}>
                {item.quantity > 1 && <span className={k.lineQty}>{item.quantity}×</span>}
                {item.name}
              </div>
              {item.modifiers.length > 0 && <div className={k.lineMods}>{item.modifiers.join(", ")}</div>}
            </div>
            {typeof item.lineTotal === "number" && <div className={k.linePrice}>{money(item.lineTotal)}</div>}
          </li>
        ))}
      </ul>
      <div className={k.totals}>
        <div className={k.totalRow}>
          <span>Subtotal</span>
          <span style={{ fontFamily: "var(--mono)" }}>{money(cart.subtotal)}</span>
        </div>
        {(cart.discounts ?? []).map((d) => (
          <div key={d.label} className={`${k.totalRow} ${k.saving}`}>
            <span>{d.label}</span>
            <span style={{ fontFamily: "var(--mono)" }}>−{money(d.amount)}</span>
          </div>
        ))}
        <div className={k.totalRow} style={{ color: "#6b6455" }}>
          <span>Tax</span>
          <span style={{ fontFamily: "var(--mono)" }}>{money(cart.tax)}</span>
        </div>
        <div className={k.grand}>
          <span className={k.grandLabel}>Total</span>
          <span className={k.grandAmount}>{money(cart.total)}</span>
        </div>
      </div>
      {earn > 0 && (
        <div className={k.earn}>
          {who ? (
            <>
              <span>
                Hi {who.firstName}! You have <b>{who.points.toLocaleString("en-US")}</b> points.
              </span>
              <span className={k.earnBig}>+{earn}</span>
            </>
          ) : (
            <>
              <span>Check in on the left to earn points on this order.</span>
              <span className={k.earnBig}>+{earn}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
