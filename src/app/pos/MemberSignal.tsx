"use client";

import { NotActiveStamp } from "./LegacyPlusCard";
import { useMemberSignal, type MemberSignal } from "./member-signal";

// Who's on the order, readable from across the counter (member-signal.ts):
// - Insiders+ that's paid for: a gold frame around the whole register and a
//   gold Insiders+ strip over the order.
// - A former unlimited member who isn't paying: a red-and-black striped
//   frame and the red NOT ACTIVE banner (LegacyPlusCard.tsx UnlimitedBanner).
//   Never gold, so nobody takes them for an active member.

// The frame sits in the page's margin, over nothing you tap (it lets every
// tap through), and under any open window.
export function SignalFrame({ signal }: { signal: MemberSignal }) {
  if (!signal) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40"
      style={
        signal === "plus"
          ? { boxShadow: "inset 0 0 0 6px var(--gold), inset 0 0 0 8px var(--foreground)" }
          : {
              // Longhands: the `border` shorthand would reset the stripes.
              borderWidth: 8,
              borderStyle: "solid",
              borderColor: "transparent",
              borderImage: "repeating-linear-gradient(-45deg, var(--accent) 0 14px, var(--foreground) 14px 28px) 8",
            }
      }
    />
  );
}

// The gold "+" seal, as on an Insiders+ member's photo (MemberAvatar).
export function PlusCoin({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 font-black leading-none"
      style={{ width: size, height: size, fontSize: size * 0.72, background: "var(--gold)", borderColor: "var(--foreground)", color: "var(--gold-foreground)" }}
      aria-hidden="true"
    >
      +
    </span>
  );
}

// Over the order while an Insiders+ member who's paying is on it.
export function PlusRibbon({ name, discount }: { name: string; discount: number }) {
  return (
    <div
      className="mb-2 flex items-center gap-2.5 rounded-lg border-2 px-2.5 py-1.5"
      style={{ background: "var(--gold)", borderColor: "var(--foreground)", color: "var(--gold-foreground)" }}
      role="status"
      aria-label={`${name}: Insiders+, active`}
    >
      <PlusCoin size={32} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="font-display text-base uppercase tracking-wide">Insiders+</div>
        <div className="text-xs font-semibold">
          {name} · {discount > 0 ? `${Math.round(discount * 100)}% off · ` : ""}free movies
        </div>
      </div>
      <span className="shrink-0 rounded-full border-2 px-2 py-0.5 text-xs font-black uppercase tracking-wide" style={{ borderColor: "var(--foreground)" }}>
        ✓ Active
      </span>
    </div>
  );
}

// Beside "Royale Cinema Lounge" in the register's title, where the title
// shows (a phone, or an iPad narrower than a regular one held upright).
export function HeaderSignal() {
  const signal = useMemberSignal();
  if (signal === "plus")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 self-center" role="status" aria-label="Insiders+ member on the order">
        <PlusCoin size={28} />
        <span className="hidden text-xs font-black uppercase tracking-wide sm:inline">Insiders+</span>
      </span>
    );
  if (signal === "unlimited")
    return (
      <span className="inline-flex shrink-0 self-center rounded-md px-1.5 py-1" style={{ background: "var(--accent-hover)" }} role="status" aria-label="Not active: no payment on file for unlimited membership">
        <NotActiveStamp />
      </span>
    );
  return null;
}
