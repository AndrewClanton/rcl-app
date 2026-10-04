"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Member } from "@/lib/types";
import type { BillingInterval } from "@/lib/membership-rates";
import { ANNUAL_PRICE, RATE_PRICE, dollars } from "@/lib/membership-rates";
import { subscriptionLive } from "@/lib/plus-status";
import ConfirmModal from "@/components/ConfirmModal";
import InfoTip from "@/components/help/InfoTip";
import { sendPaidThroughExplainerEmail, setMemberPaidThrough } from "../actions";

// The record behind the date, as the page loads it (lib/paid-through.ts).
export interface PaidThroughInfo {
  // The prepaid year covering them now (null: none, or a gift replaced it).
  inForce: { paidThrough: string; renewsAs: BillingInterval } | null;
  // The latest change, for "set by ... on ...".
  last: { paidThrough: string | null; renewsAs: BillingInterval; note: string | null; setBy: string | null; setAt: string } | null;
  // What to offer when setting one: their old-site plan, or yearly.
  defaultRenewsAs: BillingInterval;
  // A gift covers them now (then the date isn't theirs to set here).
  gifted: boolean;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const dayInput = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// Insiders+ paid ahead another way (a year on the old website) until a
// date: the register treats them as paid-for Insiders+ until then, and a
// card added meanwhile isn't charged before it. Owners and admins set it;
// any staff can email them how to add their card.
export default function PaidThroughCard({ member, info, canEdit }: { member: Member; info: PaidThroughInfo; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(info.inForce ? dayInput(info.inForce.paidThrough) : "");
  const [renewsAs, setRenewsAs] = useState<BillingInterval>(info.inForce?.renewsAs ?? info.defaultRenewsAs);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"send" | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const first = member.name.split(" ")[0] || member.name;
  const rate = member.price_tier ?? "adult";
  const price = (r: BillingInterval) => (r === "year" ? `${dollars(ANNUAL_PRICE[rate])}/year` : `$${RATE_PRICE[rate]}/month`);
  const billed = subscriptionLive(member);
  // Why it can't be set here, if it can't.
  const blocked = member.comped
    ? `${first}'s Insiders+ is complimentary.`
    : billed && !info.inForce
      ? `${first} is billed by their own card, so there's nothing paid ahead to record.`
      : info.gifted
        ? `A gifted year covers ${first} now.`
        : null;

  function act(fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await fn().catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!r.ok) return setError(r.error);
      setMessage(r.message);
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-1 text-lg font-semibold">
        Paid through
        <InfoTip topic="paid-through" />
      </h2>

      {info.inForce ? (
        <div className="mb-3 rounded border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success-text)]">
          Insiders+ paid through <strong>{day(info.inForce.paidThrough)}</strong>. Then it renews {info.inForce.renewsAs === "year" ? "yearly" : "monthly"} at{" "}
          {price(info.inForce.renewsAs)} plus tax{billed ? ", on their card (already on file)." : " once they add a card. A card added before then isn't charged until that day."}
        </div>
      ) : (
        <p className="mb-3 text-sm text-[var(--muted)]">
          For someone who paid ahead another way, like a year on the old website. Until the date they&apos;re paid-for Insiders+, and a card added meanwhile isn&apos;t charged
          before it.
        </p>
      )}

      {info.last && (
        <p className="mb-3 text-xs text-[var(--muted)]">
          {info.last.paidThrough ? `Set to ${day(info.last.paidThrough)}` : "Taken off"}
          {info.last.setBy ? ` by ${info.last.setBy}` : ""} on {day(info.last.setAt)}
          {info.last.note ? ` · ${info.last.note}` : ""}
        </p>
      )}

      {canEdit && !blocked && !billed && (
        <>
          {!editing ? (
            <div className="flex flex-wrap gap-2">
              <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => setEditing(true)} disabled={pending}>
                {info.inForce ? "Change date" : "Set a paid-through date"}
              </button>
              {info.inForce && (
                <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--danger-text)]" onClick={() => setConfirm("clear")} disabled={pending}>
                  Take it off
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                Paid through
                <input type="date" className="rounded border border-[var(--border)] px-2 py-1 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                Renews
                <button className={`chip ${renewsAs === "year" ? "chip-selected" : ""}`} onClick={() => setRenewsAs("year")}>
                  Yearly · {price("year")}
                </button>
                <button className={`chip ${renewsAs === "month" ? "chip-selected" : ""}`} onClick={() => setRenewsAs("month")}>
                  Monthly · {price("month")}
                </button>
              </div>
              <input
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm"
                placeholder="Note (e.g. old-site annual, confirmed 10/3)"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={pending || !date}
                  onClick={() => act(() => setMemberPaidThrough(member.id, date, renewsAs, note), () => setEditing(false))}
                >
                  {pending ? "Saving..." : "Save"}
                </button>
                <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => setEditing(false)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {blocked && !info.inForce && <p className="text-sm text-[var(--muted)]">{blocked}</p>}

      {info.inForce && !billed && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50" disabled={pending || !member.email} onClick={() => setConfirm("send")}>
            Send paid-through explainer
          </button>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {member.email ? `Emails ${first} the 3 steps to add a card, with no charge until ${day(info.inForce.paidThrough)}.` : "Add their email first (Profile)."}
          </p>
        </div>
      )}

      {message && <p className="mt-2 text-sm text-[var(--success-text)]">{message}</p>}
      {error && (
        <p className="mt-2 text-sm text-[var(--danger-text)]" role="alert">
          {error}
        </p>
      )}

      {confirm === "send" && (
        <ConfirmModal
          title={`Email ${first}?`}
          description={`"Your Insiders+ year is already paid": how to add a card on the website, with no charge until ${info.inForce ? day(info.inForce.paidThrough) : "their date"}.`}
          confirmLabel="Send it"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            act(() => sendPaidThroughExplainerEmail(member.id));
          }}
        />
      )}
      {confirm === "clear" && (
        <ConfirmModal
          title="Take off the paid-through date?"
          description={`${first} would no longer count as paid-for Insiders+ unless something else pays for it.`}
          confirmLabel="Take it off"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            act(() => setMemberPaidThrough(member.id, null, renewsAs, note));
          }}
        />
      )}
    </div>
  );
}
