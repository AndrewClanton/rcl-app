"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { REGISTER_CHANNEL, type RegisterCartSnapshot } from "@/lib/registerChannel";
import { findMemberByPhone, type FoundMember } from "./actions";

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
// "Sign in" is a phone-number lookup, not a real login -- just enough to
// greet a member by name and show their points, on a device only staff can
// reach in the first place.
export default function CustomerDisplay({ movies }: { movies: PromoMovie[] }) {
  const [cart, setCart] = useState<RegisterCartSnapshot | null>(null);
  const [signIn, setSignIn] = useState<"closed" | "phone" | "found" | "not-found">("closed");
  const [phone, setPhone] = useState("");
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<FoundMember | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(REGISTER_CHANNEL)
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
  }, []);

  async function submitPhone() {
    setLooking(true);
    try {
      const member = await findMemberByPhone(phone);
      setFound(member);
      setSignIn(member ? "found" : "not-found");
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        setSignIn("closed");
        setPhone("");
        setFound(null);
      }, 12000);
    } finally {
      setLooking(false);
    }
  }

  const hasOrder = !!cart && cart.items.length > 0;

  return (
    <div className="relative min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {hasOrder ? <OrderMirror cart={cart} /> : <PromoIdle movies={movies} />}

      {signIn === "closed" && (
        <button
          onClick={() => {
            if (dismissTimer.current) clearTimeout(dismissTimer.current);
            setSignIn("phone");
          }}
          // bottom-left, not bottom-right -- the sitewide Dev Notes widget
          // (src/components/DevNotesWidget.tsx) is fixed at bottom-right on
          // every page, including this one, and would otherwise sit right on
          // top of this button.
          className="btn-primary fixed bottom-6 left-6 !px-6 !py-3 text-base shadow-lg"
        >
          Sign in
        </button>
      )}

      {signIn !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(20,17,12,0.65)" }}>
          <div className="card w-full max-w-sm !p-6 text-center" style={{ background: "var(--surface)" }}>
            <button
              onClick={() => {
                if (dismissTimer.current) clearTimeout(dismissTimer.current);
                setSignIn("closed");
                setPhone("");
                setFound(null);
              }}
              className="mb-2 ml-auto block text-sm text-[var(--muted)]"
            >
              Close ✕
            </button>

            {signIn === "phone" && (
              <>
                <h2 className="font-display mb-1 text-xl">Sign in</h2>
                <p className="mb-4 text-sm text-[var(--muted)]">Enter your phone number.</p>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && phone.trim() && submitPhone()}
                  placeholder="(555) 555-5555"
                  className="input mb-4 text-center text-lg"
                />
                <button disabled={looking || !phone.trim()} onClick={submitPhone} className="btn-primary w-full">
                  {looking ? "Looking up…" : "Continue"}
                </button>
              </>
            )}

            {signIn === "found" && found && (
              <>
                <div className="relative mx-auto mb-3 h-24 w-24 overflow-hidden rounded-full border-2" style={{ borderColor: "var(--accent)", background: "var(--surface-hover)" }}>
                  {found.avatarUrl ? (
                    <Image src={found.avatarUrl} alt={found.name} fill sizes="96px" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl font-bold text-[var(--muted)]">{found.name[0]?.toUpperCase()}</div>
                  )}
                </div>
                <h2 className="font-display mb-1 text-xl">Welcome back, {found.name}!</h2>
                <p className="text-sm text-[var(--muted)]">
                  {found.tier} · {Math.round(found.points)} points
                </p>
              </>
            )}

            {signIn === "not-found" && (
              <>
                <h2 className="font-display mb-1 text-xl">No account found</h2>
                <p className="text-sm text-[var(--muted)]">Ask a staff member to help you sign up.</p>
              </>
            )}
          </div>
        </div>
      )}
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
