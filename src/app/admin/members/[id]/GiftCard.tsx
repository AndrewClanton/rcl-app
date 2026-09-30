"use client";

import { useState, useTransition } from "react";
import type { Member } from "@/lib/types";
import type { GiftMembership } from "@/lib/gift-membership";
import { ANNUAL_PRICE, dollars } from "@/lib/membership-rates";
import { giftActive, subscriptionLive } from "@/lib/plus-status";
import { createGiftLink } from "../actions";
import InfoTip from "@/components/help/InfoTip";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Someone at the box office paying for a year of Insiders+ for this member.
// One payment on the buyer's card, no renewal; the year lands here once
// Stripe confirms it (lib/gift-membership.ts).
export default function GiftCard({ member, gifts }: { member: Member; gifts: GiftMembership[] }) {
  const [pending, startTransition] = useTransition();
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const first = member.name.split(" ")[0] || member.name;
  // Why a gift can't be sold here, if it can't.
  const blocked = !member.email
    ? `Add ${first}'s email first (Profile, above). It's how they sign in to use the gift.`
    : member.comped
      ? `${first}'s Insiders+ is complimentary, so there's nothing to gift.`
      : subscriptionLive(member)
        ? `${first} already pays for Insiders+ with their own card, so a gift would double up. Sort this one out by hand for now.`
        : null;

  function giftLink(open: boolean) {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const r = await createGiftLink(member.id, { buyerName, buyerEmail, message });
      if (!r.ok) return setError(r.error);
      setLink(r.url);
      if (open) window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-1 text-lg font-semibold">
        Gift a year of Insiders+
        <InfoTip topic="gift-membership" />
      </h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Someone else pays {dollars(ANNUAL_PRICE.adult)} plus tax, once, on their own card. {first} gets 12 months of Insiders+. Nothing renews and no card goes on {first}
        &apos;s account.
      </p>

      {member.plus_gift_until && giftActive(member) && (
        <p className="mb-3 rounded border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success-text)]">
          Covered by a gift through <strong>{day(member.plus_gift_until)}</strong>. Another gift adds a year on top of that.
        </p>
      )}

      {gifts.length > 0 && (
        <ul className="mb-4 divide-y divide-[var(--border)] text-sm">
          {gifts.map((g) => (
            <li key={g.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="font-medium">From {g.buyer_name}</span>
              <span className="text-[var(--muted)]">{g.buyer_email}</span>
              <span>
                {money(g.price + g.tax_amount)}
                {g.paid_at ? ` on ${day(g.paid_at)}` : ""}
                {g.sold_by_staff?.name ? ` · sold by ${g.sold_by_staff.name}` : ""}
              </span>
              {g.starts_at && g.ends_at && (
                <span className="text-[var(--muted)]">
                  {day(g.starts_at)} → {day(g.ends_at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {blocked ? (
        <p className="text-sm">{blocked}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
              placeholder="Buyer's name"
              autoComplete="off"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
            />
            <input
              className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
              placeholder="Buyer's email (their receipt)"
              type="email"
              autoComplete="off"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
            />
          </div>
          <textarea
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm"
            placeholder={`A note for ${first} (optional, goes in their email)`}
            rows={2}
            maxLength={300}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={pending} onClick={() => giftLink(true)}>
              {pending ? "Opening..." : "Open payment page"}
            </button>
            <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50" disabled={pending} onClick={() => giftLink(false)}>
              Get a link to text the buyer
            </button>
          </div>
          {link && (
            <div className="flex gap-2">
              <input readOnly className="min-w-0 flex-1 rounded border border-[var(--border)] px-2 py-1 text-xs" value={link} onFocus={(e) => e.target.select()} />
              <button
                className="rounded border border-[var(--border)] px-3 py-1 text-xs"
                onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          <p className="text-xs text-[var(--muted)]">
            Stripe&apos;s page takes the buyer&apos;s card; hand them the device or text them the link (it works for 24 hours). Once it&apos;s paid, refresh this page to see the
            year. {first} gets an email about it once email is set up.
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
