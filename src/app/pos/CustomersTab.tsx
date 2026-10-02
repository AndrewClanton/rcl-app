"use client";

import { useEffect, useRef } from "react";
import MemberAvatar from "@/components/MemberAvatar";
import MemberFinder from "./MemberFinder";
import { CheckedInToday, CheckinResults, JustCheckedIn, WaitingToConfirm, type Checkins } from "./RegisterCheckins";
import LegacyPlusCard from "./LegacyPlusCard";
import type { PosMember } from "./member-actions";

// The register's Customers tab, beside the menu categories: everything about
// who's buying, in one place and never on top of the menu buttons.
//   1. What just happened (a check-in, tickets to print, a former
//      unlimited member with no payment on file).
//   2. Just checked in on the screen: the last 15 minutes, with Undo.
//   3. Waiting to confirm: a shared family number, to pick who it is.
//   4. Checked in today: one tap puts someone on the order.
//   5. Find a customer: search, and the regulars' faces.
// `findAt` changes when someone taps "Find by photo" in the order's Member
// box: the tab then scrolls down to Find a customer.
export default function CustomersTab({
  checkins,
  current,
  hasOrder,
  onAttach,
  findAt,
  readerId,
  employeeId,
}: {
  checkins: Checkins;
  current: PosMember | null;
  hasOrder: boolean;
  onAttach: (m: PosMember) => void;
  findAt: number;
  readerId: string | null;
  employeeId: string;
}) {
  const findRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!findAt) return;
    const el = findRef.current;
    if (!el) return;
    // On an iPad the menu panel scrolls inside itself (the page is locked to
    // the screen), so scroll that box, never the page. A phone scrolls the page.
    const box = el.closest<HTMLElement>("[data-menu-scroll]");
    if (box && getComputedStyle(box).overflowY !== "visible") {
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    } else {
      el.scrollIntoView({ block: "start" });
    }
  }, [findAt]);

  // Someone just checked in whose unlimited membership has nothing paying
  // for it (lib/legacy-plus.ts). Once they're on the order the card moves to
  // the order's Member box instead, so it's never shown twice.
  const u = checkins.unlimited;
  const showUnlimited = !!u && u.legacyUnlimited && current?.id !== u.id;

  return (
    <div className="space-y-5">
      <CheckinResults checkins={checkins} />
      {showUnlimited && u && (
        <section className="max-w-2xl" aria-label="No payment on file for unlimited membership">
          <div className="flex items-center gap-2">
            <MemberAvatar name={u.name} url={u.avatar_url} size={36} plus={false} />
            <span className="min-w-0 flex-1 truncate font-bold">{u.name}</span>
            <button className="btn-secondary min-h-11 shrink-0 !px-3 !py-1.5 text-sm" onClick={() => onAttach(u)}>
              {hasOrder ? "Add to order" : "Next order"}
            </button>
            <button
              className="-my-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-lg leading-none"
              style={{ color: "var(--muted)" }}
              aria-label="Dismiss"
              onClick={checkins.dismissUnlimited}
            >
              ×
            </button>
          </div>
          <LegacyPlusCard
            key={u.id}
            member={u}
            readerId={readerId}
            employeeId={employeeId}
            toTablet={checkins.toTablet}
            onDone={() => checkins.dismissUnlimited()}
          />
        </section>
      )}
      <JustCheckedIn checkins={checkins} />
      <WaitingToConfirm checkins={checkins} current={current} hasOrder={hasOrder} />
      <CheckedInToday here={checkins.here} current={current} onAttach={onAttach} />
      <div ref={findRef} className="scroll-mt-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <MemberFinder current={current} onPick={onAttach} allowNew />
      </div>
    </div>
  );
}
