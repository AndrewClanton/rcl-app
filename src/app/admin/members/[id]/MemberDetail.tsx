"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommunityProgram, Member, MemberPriceTier, MemberTier } from "@/lib/types";
import type { MemberPurchase } from "@/lib/data/members";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import ManagerPinModal from "@/components/ManagerPinModal";
import { refundBooking, refundOrder } from "@/app/admin/reports/actions";
import { createMemberBillingPortalLink, deleteMember, grantFreeMembership, revokeFreeMembership, updateMember } from "../actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function MemberDetail({
  member,
  purchases,
  communityPrograms,
}: {
  member: Member;
  purchases: MemberPurchase[];
  communityPrograms: CommunityProgram[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/members" className="text-sm text-neutral-500 hover:underline">
          ← All members
        </Link>
      </div>

      <ProfileCard member={member} />
      <FreeMembershipCard member={member} communityPrograms={communityPrograms} />
      <BillingCard member={member} />
      <PurchaseHistoryCard purchases={purchases} />
      <DangerZone member={member} />
    </div>
  );
}

function ProfileCard({ member }: { member: Member }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [points, setPoints] = useState(String(member.points));

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{member.name}</h1>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            member.tier === "Insiders+"
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
          }`}
        >
          {member.tier}
        </span>
        {member.monthly_member && (
          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-400">
            Monthly
          </span>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          Member since {new Date(member.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== member.name) run(() => updateMember(member.id, { name: name.trim() }));
            }}
          />
        </Field>
        <Field label="Email">
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              if (email !== (member.email ?? "")) run(() => updateMember(member.id, { email: email.trim() || null }));
            }}
          />
        </Field>
        <Field label="Phone">
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
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
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
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
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={member.tier}
            disabled={pending}
            onChange={(e) => run(() => updateMember(member.id, { tier: e.target.value as MemberTier }))}
          >
            <option value="Insiders">Insiders</option>
            <option value="Insiders+">Insiders+</option>
          </select>
        </Field>
        {member.tier === "Insiders+" && (
          <Field label="Price tier" hint="Set to 'student' for an in-person counter upgrade (not sold online).">
            <select
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={member.price_tier ?? ""}
              disabled={pending}
              onChange={(e) => run(() => updateMember(member.id, { price_tier: (e.target.value || null) as MemberPriceTier | null }))}
            >
              <option value="">Not set...</option>
              <option value="adult">Adult ($15/mo)</option>
              <option value="senior">Senior ($12/mo)</option>
              <option value="student">Student ($10/mo, in-person)</option>
            </select>
          </Field>
        )}
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
            <span className="text-sm text-neutral-500">{member.subscription_status} (syncs automatically)</span>
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-neutral-500">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
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
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-3 text-lg font-semibold">Free / community membership</h2>
      {member.comped ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
              Free · {member.community_program?.name ?? "Community program"}
            </span>
            {member.comped_at && (
              <span className="text-xs text-neutral-500">since {new Date(member.comped_at).toLocaleDateString()}</span>
            )}
          </div>
          {member.comp_notes && <p className="text-sm text-neutral-500">{member.comp_notes}</p>}
          <button
            className="text-xs text-neutral-500 hover:underline"
            disabled={pending}
            onClick={() => {
              if (confirm(`Remove free-membership status from "${member.name}"?`)) run(() => revokeFreeMembership(member.id));
            }}
          >
            Revoke free membership
          </button>
        </div>
      ) : formOpen ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-xs text-neutral-500">Community program</label>
              <select
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
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
              <label className="mb-1 block text-xs text-neutral-500">Notes (optional)</label>
              <input
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                placeholder="e.g. referred by St. Mary's food pantry"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              disabled={pending}
              onClick={() => {
                run(() => grantFreeMembership(member.id, { communityProgramId: programId || null, notes }));
                setFormOpen(false);
              }}
            >
              Grant Insiders+ free
            </button>
            <button className="text-xs text-neutral-500 hover:underline" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="text-sm text-neutral-500 hover:underline" onClick={() => setFormOpen(true)}>
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
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-3 text-lg font-semibold">Billing</h2>
      {member.stripe_customer_id ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-neutral-500">Subscription: {member.subscription_status ?? "unknown"}</span>
          <button
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
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
        <p className="text-sm text-neutral-500">
          {member.comped ? "Free membership via community program -- no billing account." : "No billing account on file."}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-neutral-400">
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
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-3 text-lg font-semibold">Purchase history</h2>
      {purchases.length === 0 ? (
        <p className="text-sm text-neutral-500">No purchases on file for this member.</p>
      ) : (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {purchases.map((p, i) => (
            <div key={`${p.kind}-${p.id}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              {i === 0 && (
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 dark:border-neutral-700">
                  Last purchase
                </span>
              )}
              <span>{p.label}</span>
              <span className="text-neutral-500">{money(p.total)}</span>
              <span className="text-xs text-neutral-400">
                {new Date(p.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
              </span>
              {p.status === "refunded" ? (
                <span className="rounded-full border border-red-500 px-2 py-0.5 text-xs text-red-600">Refunded</span>
              ) : p.total > 0 ? (
                <button
                  className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
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
    <div className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-neutral-950">
      <h2 className="mb-3 text-lg font-semibold text-red-600">Danger zone</h2>
      <button
        className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50 dark:border-red-900"
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
