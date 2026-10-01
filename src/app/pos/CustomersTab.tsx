"use client";

import { useEffect, useRef } from "react";
import MemberFinder from "./MemberFinder";
import { CheckedInToday, CheckinResults, WaitingToConfirm, type Checkins } from "./RegisterCheckins";
import type { PosMember } from "./member-actions";

// The register's Customers tab, beside the menu categories: everything about
// who's buying, in one place and never on top of the menu buttons.
//   1. What just happened (a check-in confirmed, tickets to print).
//   2. Waiting to confirm: check-ins from the customer screen.
//   3. Checked in today: one tap puts someone on the order.
//   4. Find a customer: search, and the regulars' faces.
// `findAt` changes when someone taps "Find by photo" in the order's Member
// box: the tab then scrolls down to Find a customer.
export default function CustomersTab({
  checkins,
  current,
  hasOrder,
  onAttach,
  findAt,
}: {
  checkins: Checkins;
  current: PosMember | null;
  hasOrder: boolean;
  onAttach: (m: PosMember) => void;
  findAt: number;
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

  return (
    <div className="space-y-5">
      <CheckinResults checkins={checkins} />
      <WaitingToConfirm checkins={checkins} current={current} hasOrder={hasOrder} />
      <CheckedInToday here={checkins.here} current={current} onAttach={onAttach} />
      <div ref={findRef} className="scroll-mt-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <MemberFinder current={current} onPick={onAttach} />
      </div>
    </div>
  );
}
