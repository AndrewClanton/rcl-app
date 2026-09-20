"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ManagerPinModal from "@/components/ManagerPinModal";
import type { Booth, BoothReservation } from "@/lib/types";
import { updateBooth, cancelBoothReservation } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function BoothRow({ booth }: { booth: Booth }) {
  const router = useRouter();
  const [capacity, setCapacity] = useState(booth.capacity);
  const [fee, setFee] = useState(booth.reservation_fee);
  const [active, setActive] = useState(booth.active);
  const [saving, setSaving] = useState(false);
  const dirty = capacity !== booth.capacity || fee !== booth.reservation_fee || active !== booth.active;

  async function save() {
    setSaving(true);
    try {
      await updateBooth(booth.id, { capacity, reservationFee: fee, active });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-2 items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-sm sm:grid-cols-5 ">
      <div className="font-medium">{booth.label}</div>
      <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
        Capacity
        <input type="number" min={1} className="w-14 rounded border border-[var(--border)] px-1 py-0.5 " value={capacity} onChange={(e) => setCapacity(Math.max(1, parseInt(e.target.value) || 1))} />
      </label>
      <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
        Fee $
        <input type="number" min={0} step="0.01" className="w-16 rounded border border-[var(--border)] px-1 py-0.5 " value={fee} onChange={(e) => setFee(Math.max(0, parseFloat(e.target.value) || 0))} />
      </label>
      <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <button className="justify-self-start rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40 " disabled={!dirty || saving} onClick={save}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function ReservationRow({ reservation }: { reservation: BoothReservation }) {
  const router = useRouter();
  const [pinOpen, setPinOpen] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] p-3 ">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {reservation.booth?.label ?? "Booth"} — {fmtDate(reservation.reservation_date)} {fmtTime(reservation.start_time)} — {reservation.customer_name} ({reservation.party_size})
        </span>
        {reservation.status === "cancelled" ? (
          <span className="rounded-full border border-[var(--danger-text)] px-2 py-0.5 text-xs text-[var(--danger-text)]">Cancelled</span>
        ) : reservation.status === "pending" ? (
          <span className="rounded-full border border-[var(--warn-border)] px-2 py-0.5 text-xs text-[var(--warn-text)]">Pending payment</span>
        ) : (
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs " onClick={() => setPinOpen(true)}>
            Cancel &amp; refund
          </button>
        )}
      </div>
      <div className="mt-1 text-xs text-[var(--muted)]">
        {reservation.customer_email}
        {reservation.customer_phone ? ` · ${reservation.customer_phone}` : ""} · {money(reservation.fee_amount)}
      </div>

      {pinOpen && (
        <ManagerPinModal
          description="Manager approval is required to cancel and refund this reservation."
          onCancel={() => setPinOpen(false)}
          onSubmit={async (pin) => {
            await cancelBoothReservation(reservation.id, pin);
            setPinOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

export default function BoothsAdminPanel({ booths, reservations }: { booths: Booth[]; reservations: BoothReservation[] }) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold">Booths</h2>
        <div className="space-y-2">
          {booths.map((b) => (
            <BoothRow key={b.id} booth={b} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Upcoming reservations</h2>
        {reservations.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No upcoming reservations.</div>
        ) : (
          <div className="space-y-2">
            {reservations.map((r) => (
              <ReservationRow key={r.id} reservation={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
