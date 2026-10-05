"use client";

import { useState } from "react";
import BoothsToday from "./BoothsToday";
import { CountBadge, Dialog } from "./ui";
import { openStaff, promptStartShift, refreshStaff, useStaff } from "./staff-store";

// The register's one button for everything about working here: shifts,
// the checklist, Ran out, the par sheet and shopping list, the schedule,
// history and hours (StaffTools opens the sheet). Sits beside the cashier
// at the top of the order, where the shift bar used to take a whole row.
// Nobody on shift yet: it's the day's one Start shift prompt instead.
export function StaffButton() {
  const s = useStaff();
  if (s.loaded && s.nobodyOn) {
    return (
      <button className="btn-primary min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm" onClick={promptStartShift}>
        Start shift
      </button>
    );
  }
  const label = s.offline ? "Staff: can't reach the server" : s.badge > 0 ? `Staff: ${s.badge} to look at` : "Staff";
  return (
    <button
      className="chip relative min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm font-bold"
      style={{ borderColor: "var(--foreground)" }}
      onClick={() => openStaff()}
      aria-label={label}
      title={label}
    >
      Staff
      {s.offline ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: "var(--warn-text)" }} aria-hidden>
          !
        </span>
      ) : (
        <CountBadge n={s.badge} className="absolute -right-2 -top-2" />
      )}
    </button>
  );
}

// Booths held today, as a button in the register's bottom row: gold while a
// Reserved card still needs printing, a red dot for a booking made in the
// last day. Opens the list with the print buttons (BoothsToday). Not there
// at all with nothing booked today or tomorrow.
export function BoothsButton({ className = "" }: { className?: string }) {
  const { booths } = useStaff();
  const [open, setOpen] = useState(false);
  if (!booths || (booths.today.length === 0 && booths.tomorrow.length === 0)) return null;
  const waiting = booths.today.filter((h) => !h.cardPrintedAt).length;
  const fresh = [...booths.today, ...booths.tomorrow].some((h) => h.isNew);
  const n = booths.today.length;
  const label = n > 0 ? `${n} booth${n === 1 ? "" : "s"}` : "Booths";
  return (
    <>
      <button
        className={`relative ${className}`}
        style={waiting > 0 ? { background: "var(--gold)", color: "var(--gold-foreground)" } : undefined}
        onClick={() => setOpen(true)}
        aria-label={`Booths today: ${n}${waiting ? `, ${waiting} Reserved card${waiting === 1 ? "" : "s"} to print` : ""}${fresh ? ", new booking" : ""}`}
      >
        {label}
        {fresh && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 0 2px var(--surface)" }} aria-hidden />}
      </button>
      {open && (
        <Dialog title="Booths today" onClose={() => setOpen(false)}>
          <BoothsToday booths={booths} onChanged={refreshStaff} bare />
        </Dialog>
      )}
    </>
  );
}
