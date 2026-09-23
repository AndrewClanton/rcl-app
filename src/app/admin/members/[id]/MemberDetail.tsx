"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommunityProgram, Member, MemberPriceTier, MemberTier } from "@/lib/types";
import type { MemberPurchase } from "@/lib/data/members";
import type { MemberStaffInfo } from "@/lib/data/employees";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import StaffBadge from "../StaffBadge";
import ManagerPinModal from "@/components/ManagerPinModal";
import { refundBooking, refundOrder } from "@/app/admin/reports/actions";
import { RATE_LABEL, RATE_ORDER, RATE_PRICE } from "@/lib/membership-rates";
import { createMemberBillingPortalLink, deleteMember, grantFreeMembership, revokeFreeMembership, setMemberRate, updateMember } from "../actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function MemberDetail({
  member,
  purchases,
  communityPrograms,
  staffInfo,
}: {
  member: Member;
  purchases: MemberPurchase[];
  communityPrograms: CommunityProgram[];
  staffInfo: MemberStaffInfo | undefined;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/members" className="text-sm text-[var(--muted)] hover:underline">
          ← All members
        </Link>
      </div>

      <ProfileCard member={member} staffInfo={staffInfo} />
      <FreeMembershipCard member={member} communityPrograms={communityPrograms} />
      <BillingCard member={member} />
      <PurchaseHistoryCard purchases={purchases} />
      <DangerZone member={member} />
    </div>
  );
}

function ProfileCard({ member, staffInfo }: { member: Member; staffInfo: MemberStaffInfo | undefined }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [points, setPoints] = useState(String(member.points));

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {member.avatar_url && (
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[var(--border)]">
            <Image src={member.avatar_url} alt={member.name} fill sizes="40px" className="object-cover" />
          </div>
        )}
        <h1 className="text-xl font-semibold">{member.name}</h1>
        <StaffBadge info={staffInfo} />
        {member.avatar_url && (
          <button
            className="text-xs text-[var(--muted)] hover:underline"
            disabled={pending}
            onClick={() => {
              if (confirm("Remove this member's profile photo? Shown on the customer-facing kiosk after phone sign-in.")) {
                run(() => updateMember(member.id, { avatar_url: null }));
              }
            }}
          >
            Remove photo
          </button>
        )}
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            member.tier === "Insiders+"
              ? "border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] "
              : "border-[var(--border)] text-[var(--muted)] "
          }`}
        >
          {member.tier}
        </span>
        {member.monthly_member && (
          <span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-xs text-[var(--success-text)]">
            Monthly
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--muted)]">
          Member since {new Date(member.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== member.name) run(() => updateMember(member.id, { name: name.trim() }));
            }}
          />
        </Field>
        <Field label="Email">
          <input
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              if (email !== (member.email ?? "")) run(() => updateMember(member.id, { email: email.trim() || null }));
            }}
          />
        </Field>
        <Field label="Phone">
          <input
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              if (phone !== (member.phone ?? "")) run(() => updateMember(member.id, { phone: phone.trim() || null }));
            }}
          />
        </Field>
        <Field label="Points">
          <input
            type="number"
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            onBlur={() => {
              const v = parseFloat(points);
              if (!isNaN(v) && v !== member.points) run(() => updateMember(member.id, { points: v }));
            }}
          />
        </Field>
        <Field label="Tier">
          <select
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
            value={member.tier}
            disabled={pending}
            onChange={(e) => run(() => updateMember(member.id, { tier: e.target.value as MemberTier }))}
          >
            <option value="Insiders">Insiders</option>
            <option value="Insiders+">Insiders+</option>
          </select>
        </Field>
        <RateField member={member} />
        <Field label="Monthly member">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={member.monthly_member}
              disabled={pending}
              onChange={(e) => run(() => updateMember(member.id, { monthly_member: e.target.checked }))}
            />
            Counts toward monthly-member discount
          </label>
        </Field>
        {member.stripe_subscription_id && (
          <Field label="Stripe subscription">
            <span className="text-sm text-[var(--muted)]">{member.subscription_status} (syncs automatically)</span>
          </Field>
        )}
      </div>
    </div>
  );
}

// Senior/student rates are only set after checking an ID in person. For a
// paying Insiders+ member the Stripe price changes from their next bill.
function RateField({ member }: { member: Member }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const rate: MemberPriceTier = member.price_tier ?? "adult";
  const setAt = member.price_tier_set_at
    ? new Date(member.price_tier_set_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })
    : null;
  const source =
    rate === "adult" ? null : member.rate_set_by?.name && setAt ? `Set by ${member.rate_set_by.name}, ${setAt}` : setAt ? `Set ${setAt}` : "Carried over from the old website";

  return (
    <Field label="Rate" hint="Senior and student rates need an ID checked in person. For Insiders+ members, the new price starts with their next bill.">
      <select
        className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
        value={rate}
        disabled={pending}
        onChange={(e) => {
          const t = e.target.value as MemberPriceTier;
          const check = t === "adult" ? "" : " Only after checking their ID in person.";
          if (!confirm(`Switch ${member.name} to the ${RATE_LABEL[t]} rate (${RATE_PRICE[t]}/mo for Insiders+)?${check}`)) return;
          setResult(null);
          startTransition(async () => {
            const r = await setMemberRate(member.id, t);
            setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            router.refresh();
          });
        }}
      >
        {RATE_ORDER.map((t) => (
          <option key={t} value={t}>
            {RATE_LABEL[t]} (${RATE_PRICE[t]}/mo)
          </option>
        ))}
      </select>
      {source && <p className="mt-1 text-xs text-[var(--muted)]">{source}</p>}
      {result && <p className={`mt-1 text-xs ${result.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>{result.text}</p>}
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--muted)]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function FreeMembershipCard({ member, communityPrograms }: { member: Member; communityPrograms: CommunityProgram[] }) {
  const [pending, run] = useRefreshingAction();
  const [formOpen, setFormOpen] = useState(false);
  const [programId, setProgramId] = useState("");
  const [notes, setNotes] = useState("");
  const activePrograms = communityPrograms.filter((p) => p.active);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Free / community membership</h2>
      {member.comped ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-xs text-[var(--success-text)] ">
              Free · {member.community_program?.name ?? "Community program"}
            </span>
            {member.comped_at && (
              <span className="text-xs text-[var(--muted)]">since {new Date(member.comped_at).toLocaleDateString()}</span>
            )}
          </div>
          {member.comp_notes && <p className="text-sm text-[var(--muted)]">{member.comp_notes}</p>}
          <button
            className="text-xs text-[var(--muted)] hover:underline"
            disabled={pending}
            onClick={() => {
              if (confirm(`Remove free-membership status from "${member.name}"?`)) run(() => revokeFreeMembership(member.id));
            }}
          >
            Revoke free membership
          </button>
        </div>
      ) : formOpen ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 ">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-xs text-[var(--muted)]">Community program</label>
              <select
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
              >
                <option value="">None specified</option>
                {activePrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-[2] min-w-[220px]">
              <label className="mb-1 block text-xs text-[var(--muted)]">Notes (optional)</label>
              <input
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                placeholder="e.g. referred by St. Mary's food pantry"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50 "
              disabled={pending}
              onClick={() => {
                run(() => grantFreeMembership(member.id, { communityProgramId: programId || null, notes }));
                setFormOpen(false);
              }}
            >
              Grant Insiders+ free
            </button>
            <button className="text-xs text-[var(--muted)] hover:underline" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="text-sm text-[var(--muted)] hover:underline" onClick={() => setFormOpen(true)}>
          Grant free membership...
        </button>
      )}
    </div>
  );
}

function BillingCard({ member }: { member: Member }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Billing</h2>
      {member.stripe_customer_id ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--muted)]">Subscription: {member.subscription_status ?? "unknown"}</span>
          <button
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm "
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const { url } = await createMemberBillingPortalLink(member.id);
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Couldn't open billing portal.");
                }
              });
            }}
          >
            {pending ? "Opening..." : "Update payment method / card on file"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          {member.comped ? "Free membership via community program -- no billing account." : "No billing account on file."}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">
        Opens Stripe&apos;s own secure page in a new tab -- hand the device to the member to enter their new card there. We never see or
        store the card number.
      </p>
    </div>
  );
}

function PurchaseHistoryCard({ purchases }: { purchases: MemberPurchase[] }) {
  const router = useRouter();
  const [refundTarget, setRefundTarget] = useState<MemberPurchase | null>(null);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Purchase history</h2>
      {purchases.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No purchases on file for this member.</p>
      ) : (
        <div className="divide-y divide-[var(--border)] ">
          {purchases.map((p, i) => (
            <div key={`${p.kind}-${p.id}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              {i === 0 && (
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] ">
                  Last purchase
                </span>
              )}
              <span>{p.label}</span>
              <span className="text-[var(--muted)]">{money(p.total)}</span>
              <span className="text-xs text-[var(--muted)]">
                {new Date(p.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
              </span>
              {p.status === "refunded" ? (
                <span className="rounded-full border border-[var(--danger-text)] px-2 py-0.5 text-xs text-[var(--danger-text)]">Refunded</span>
              ) : p.total > 0 ? (
                <button
                  className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs "
                  onClick={() => setRefundTarget(p)}
                >
                  Refund
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {refundTarget && (
        <ManagerPinModal
          title="Refund purchase"
          description={`Manager approval is required to refund "${refundTarget.label}" (${money(refundTarget.total)}). If it was paid by card, this returns the money via Stripe.`}
          onCancel={() => setRefundTarget(null)}
          onSubmit={async (pin) => {
            if (refundTarget.kind === "order") await refundOrder(refundTarget.id, pin);
            else await refundBooking(refundTarget.id, pin);
            setRefundTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DangerZone({ member }: { member: Member }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-red-200 bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold text-[var(--danger-text)]">Danger zone</h2>
      <button
        className="rounded border border-[var(--danger-text)] px-3 py-1.5 text-sm text-[var(--danger-text)] disabled:opacity-50 "
        disabled={pending}
        onClick={() => {
          if (!confirm(`Permanently remove member "${member.name}"? This cannot be undone.`)) return;
          startTransition(async () => {
            await deleteMember(member.id);
            router.push("/admin/members");
          });
        }}
      >
        Remove member
      </button>
    </div>
  );
}
