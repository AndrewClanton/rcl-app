"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommunityProgram, Member, MemberPriceTier, MemberTier } from "@/lib/types";
import type { EraseLogEntry, MemberCard, MemberPurchase } from "@/lib/data/members";
import type { MemberStaffInfo } from "@/lib/data/employees";
import type { GiftMembership } from "@/lib/gift-membership";
import type { PointsHistoryRow } from "@/lib/data/points-history";
import GiftCard from "./GiftCard";
import { PointsBalance, PointsHistoryCard } from "./PointsCard";
import type { PastVisits } from "@/lib/data/fortis-lookup";
import ProfileModeration from "./ProfileModeration";
import SignInHelpCard from "./SignInHelpCard";
import type { SignInHelpCard as SignInHelpInfo } from "@/lib/sign-in-help";
import InfoTip from "@/components/help/InfoTip";
import type { HelpTopicKey } from "@/lib/help/topics";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import StaffBadge from "../StaffBadge";
import ManagerPinModal from "@/components/ManagerPinModal";
import ConfirmModal from "@/components/ConfirmModal";
import { firstName } from "@/lib/card-match";
import { approvalText } from "@/lib/pin-rules";
import { refundBooking, refundOrder } from "@/app/admin/reports/actions";
import { ANNUAL_PRICE, RATE_LABEL, RATE_ORDER, RATE_PRICE, dollars } from "@/lib/membership-rates";
import { giftEndsWithoutRenewal, plusNeedsCard, plusPaidFor } from "@/lib/plus-status";
import { birthdayToInput } from "@/lib/visits";
import BirthdayPicker from "@/components/BirthdayPicker";
import {
  createMemberBillingPortalLink,
  createMemberCardLink,
  eraseMemberPersonalInfo,
  grantFreeMembership,
  revokeFreeMembership,
  saveMemberDetails,
  setMemberRate,
  linkCardFromSale,
  relinkMemberCard,
  undoCardMatchInBackOffice,
  unlinkMemberCard,
  updateMember,
} from "../actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function MemberDetail({
  member,
  purchases,
  communityPrograms,
  staffInfo,
  viewerIsAdmin,
  gifts,
  canEditContact,
  eraseLog,
  pointsHistory,
  pastVisits = null,
  signInHelp = null,
  cards,
  canUndoCardMatch,
}: {
  member: Member;
  gifts: GiftMembership[];
  purchases: MemberPurchase[];
  communityPrograms: CommunityProgram[];
  staffInfo: MemberStaffInfo | undefined;
  viewerIsAdmin: boolean;
  // False for a cashier: email and phone arrive shortened (j•••@gmail.com)
  // and are shown, not edited.
  canEditContact: boolean;
  eraseLog: EraseLogEntry | null;
  pointsHistory: { rows: PointsHistoryRow[]; total: number };
  // Visits on the old card machine (lib/data/fortis-lookup.ts getPastVisits).
  pastVisits?: PastVisits | null;
  // The "Send sign-in help" card (lib/sign-in-help.ts signInHelpCard).
  signInHelp?: SignInHelpInfo | null;
  cards: MemberCard[];
  // Managers and up can undo a sale the card found this member for, and
  // link a removed card again.
  canUndoCardMatch: boolean;
}) {
  // Personal info removed on request: nothing left to edit, but the
  // purchases stay visible for refunds and bookkeeping.
  if (member.erased_at) {
    const day = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    // The request date is a plain YYYY-MM-DD; read it at noon so no
    // timezone can shift it a day. Days taken count calendar days in
    // Central time, against the 30 promised on /data-deletion.
    const askedDay = eraseLog?.requested_on ? day(`${eraseLog.requested_on}T12:00:00`) : null;
    const erasedOn = new Date(member.erased_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const daysTaken = eraseLog?.requested_on
      ? Math.max(0, Math.round((Date.parse(`${erasedOn}T00:00:00Z`) - Date.parse(`${eraseLog.requested_on}T00:00:00Z`)) / 86_400_000))
      : null;
    return (
      <div className="space-y-6">
        <div>
          <Link href="/admin/members" className="text-sm text-[var(--muted)] hover:underline">
            ← All members
          </Link>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h1 className="text-xl font-semibold">Removed member</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Personal info removed on {day(member.erased_at)}
            {member.erased_by_staff?.name ? ` by ${member.erased_by_staff.name}` : ""}, at their request. Their purchases below stay for taxes and
            refunds, without their name.
          </p>
          {askedDay && (
            <p className="mt-1 text-sm text-[var(--muted)]">
              They asked on {askedDay}
              {daysTaken !== null ? ` (done ${daysTaken === 0 ? "the same day" : `${daysTaken} day${daysTaken === 1 ? "" : "s"} later`}; we promise 30)` : ""}.
            </p>
          )}
        </div>
        <PurchaseHistoryCard member={member} purchases={purchases} canUndoCardMatch={false} />
      </div>
    );
  }

  return (
    // A computer: their details on the left, the membership cards (free,
    // billing, gifts) down the right, and the purchases across the bottom.
    <div className="space-y-6 xl:grid xl:grid-cols-2 xl:items-start xl:gap-6 xl:space-y-0">
      <div className="xl:col-span-2">
        <Link href="/admin/members" className="text-sm text-[var(--muted)] hover:underline">
          ← All members
        </Link>
      </div>

      <ProfileCard member={member} staffInfo={staffInfo} canEditContact={canEditContact} />
      <div className="space-y-6">
        <FreeMembershipCard member={member} communityPrograms={communityPrograms} />
        <BillingCard member={member} />
        <LinkedCardsCard member={member} cards={cards} canRelink={canUndoCardMatch} />
        <GiftCard member={member} gifts={gifts} />
        {signInHelp && <SignInHelpCard memberId={member.id} memberName={member.name} info={signInHelp} />}
      </div>
      {pastVisits && (pastVisits.days > 0 || pastVisits.waiting > 0) && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm xl:col-span-2">
          <span className="font-semibold">Visits before our new system:</span>{" "}
          {pastVisits.days > 0 ? (
            <>
              {pastVisits.days.toLocaleString("en-US")}
              {pastVisits.since ? `, starting ${pastVisits.since}` : ""}
            </>
          ) : (
            "none confirmed yet"
          )}
          {pastVisits.waiting > 0 && (
            <span className="text-[var(--muted)]">
              {" "}
              · {pastVisits.waiting.toLocaleString("en-US")} more day{pastVisits.waiting === 1 ? "" : "s"} on a card matched automatically, waiting for review
            </span>
          )}
        </div>
      )}
      <div className="xl:col-span-2">
        <PointsHistoryCard memberId={member.id} initial={pointsHistory} />
      </div>
      <div className="xl:col-span-2">
        <PurchaseHistoryCard member={member} purchases={purchases} canUndoCardMatch={canUndoCardMatch} />
      </div>
      {viewerIsAdmin && (
        <div className="xl:col-span-2">
          <MergeDuplicateCard member={member} />
        </div>
      )}
      <div className="xl:col-span-2">
        <RemovePersonalInfo member={member} purchaseCount={purchases.length} isStaffLogin={!!staffInfo} viewerIsAdmin={viewerIsAdmin} />
      </div>
    </div>
  );
}

function ProfileCard({ member, staffInfo, canEditContact }: { member: Member; staffInfo: MemberStaffInfo | undefined; canEditContact: boolean }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [birthday, setBirthday] = useState(birthdayToInput(member.birthday));
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty =
    name !== member.name ||
    email !== (member.email ?? "") ||
    phone !== (member.phone ?? "") ||
    birthday !== birthdayToInput(member.birthday);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaved(null);
    startSave(async () => {
      // A cashier's copy of the email and phone is shortened, so it's never
      // sent back: saving would overwrite the real ones with the dots.
      const r = await saveMemberDetails(member.id, canEditContact ? { name, email, phone, birthday } : { name, birthday }).catch(() => null);
      if (!r) return setSaved({ ok: false, text: "Couldn't save. Try again." });
      setSaved(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  function undo() {
    setName(member.name);
    setEmail(member.email ?? "");
    setPhone(member.phone ?? "");
    setBirthday(birthdayToInput(member.birthday));
    setSaved(null);
  }

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
        {plusNeedsCard(member) && (
          <span className="rounded-full border border-[var(--danger-text)] px-2 py-0.5 text-xs text-[var(--danger-text)]" title="Set to Insiders+ by hand; nothing is billing them. See Billing below.">
            No card on file
          </span>
        )}
        {member.monthly_member && (
          <span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-xs text-[var(--success-text)]">
            Monthly
          </span>
        )}
        <ProfileModeration member={member} />
        <span className="ml-auto text-xs text-[var(--muted)]">
          Member since {new Date(member.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Name, email, phone and birthday save together with the button
            (or Enter). Points move only by adding or taking away, with a
            reason (below the button); the rest save as soon as they're
            changed. */}
        <form onSubmit={save} className="contents">
          <Field label="Name">
            <input className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm " value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {canEditContact ? (
            <>
              <Field label="Email" hint={member.stripe_customer_id ? "Saving a new email updates Stripe too, so their receipts follow it." : undefined}>
                <input
                  type="email"
                  className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input type="tel" className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm " value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Email" hint="Shortened for privacy. A manager can see or change it.">
                <div className="px-2 py-1.5 text-sm text-[var(--muted)]">{member.email ?? "—"}</div>
              </Field>
              <Field label="Phone">
                <div className="px-2 py-1.5 text-sm text-[var(--muted)]">{member.phone ?? "—"}</div>
              </Field>
            </>
          )}
          <Field label="Birthday" hint="Month and day only. Checking in during their birthday week earns the Birthday Visit badge.">
            <BirthdayPicker value={birthday} onChange={setBirthday} className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm " />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!dirty || saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            {dirty && !saving && (
              <>
                <span className="text-sm font-semibold text-[var(--warn-text)]">Unsaved changes</span>
                <button type="button" className="text-sm text-[var(--muted)] hover:underline" onClick={undo}>
                  Undo
                </button>
              </>
            )}
            {saved && (!dirty || !saved.ok) && (
              <span className={`text-sm ${saved.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`} role={saved.ok ? "status" : "alert"}>
                {saved.text}
              </span>
            )}
          </div>
        </form>
        <div className="sm:col-span-2">
          <PointsBalance memberId={member.id} balance={Number(member.points)} />
        </div>
        <Field label="Tier" help="insiders-vs-plus">
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
    <Field label="Rate" help="senior-student-rates" hint="Senior and student rates need an ID checked in person. For Insiders+ members, the new price starts with their next bill.">
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

function Field({ label, hint, help, children }: { label: string; hint?: string; help?: HelpTopicKey; children: React.ReactNode }) {
  return (
    <div>
      {/* The bubble sits beside the label, not in it: a button inside a
          <label> would become what the label clicks. */}
      <div className="mb-1 text-xs text-[var(--muted)]">
        <label>{label}</label>
        {help && <InfoTip topic={help} />}
      </div>
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
      <h2 className="mb-3 text-lg font-semibold">
        Free / community membership
        <InfoTip topic="free-membership" />
      </h2>
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
  const [firstCharge, setFirstCharge] = useState("");
  const [annual, setAnnual] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Stripe won't hold a first charge less than 2 days out.
  const [minFirstCharge] = useState(() => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  const needsCard = plusNeedsCard(member);
  // On a gifted year with nothing after it: the card can go on now, with
  // the first charge held until the gift ends.
  const giftEnds = giftEndsWithoutRenewal(member);

  function cardLink(open: boolean) {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const r = await createMemberCardLink(member.id, firstCharge || null, annual);
      if (!r.ok) return setError(r.error);
      setLink(r.url);
      if (open) window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">
        Billing
        <InfoTip topic="member-billing" />
      </h2>
      {!member.comped && (!plusPaidFor(member) || giftEnds) ? (
        // No card billing them: someone set to Insiders+ by hand, or anyone
        // joining in person. Stripe's page takes the card; we never see it.
        <div className="space-y-3">
          <p className="text-sm">
            {giftEnds ? (
              <>
                <strong>Covered by a gift until {new Date(giftEnds).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}.</strong>{" "}
                To keep Insiders+ going after that, put their own card on now. The first charge waits until the gift ends.
              </>
            ) : needsCard ? (
              <>
                <strong>Insiders+ with no card on file.</strong> They have the perks, but nothing is billing them. Put a card on it:
              </>
            ) : (
              "No card on file. To start their Insiders+ billing:"
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            Plan
            <button className={`chip ${!annual ? "chip-selected" : ""}`} onClick={() => setAnnual(false)}>
              Monthly · ${RATE_PRICE[member.price_tier ?? "adult"]}
            </button>
            <button className={`chip ${annual ? "chip-selected" : ""}`} onClick={() => setAnnual(true)}>
              Yearly · {dollars(ANNUAL_PRICE[member.price_tier ?? "adult"])} (15% off)
            </button>
          </div>
          <label className={`flex flex-wrap items-center gap-2 text-sm ${giftEnds ? "hidden" : ""}`}>
            First charge
            <input type="date" className="rounded border border-[var(--border)] px-2 py-1 text-sm" min={minFirstCharge} value={firstCharge} onChange={(e) => setFirstCharge(e.target.value)} />
            <span className="text-xs text-[var(--muted)]">{firstCharge ? "Card saved now, first charge that day" : "Blank = charge today"}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={pending} onClick={() => cardLink(true)}>
              {pending ? "Opening..." : "Open card page"}
            </button>
            <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50" disabled={pending} onClick={() => cardLink(false)}>
              Get a link to text them
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
            Set a later first charge for someone who already paid this month another way (cash, or the old site). The link works for 24 hours.
          </p>
        </div>
      ) : member.stripe_customer_id ? (
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

function PurchaseHistoryCard({ member, purchases, canUndoCardMatch }: { member: Member; purchases: MemberPurchase[]; canUndoCardMatch: boolean }) {
  const router = useRouter();
  const [refundTarget, setRefundTarget] = useState<MemberPurchase | null>(null);
  const [refunded, setRefunded] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<MemberPurchase | null>(null);
  const [linkTarget, setLinkTarget] = useState<MemberPurchase | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardBusy, startCard] = useTransition();
  const who = firstName(member.name);

  function undo(target: MemberPurchase, unlink: boolean) {
    setUndoTarget(null);
    setCardError(null);
    startCard(async () => {
      const ref = target.kind === "order" ? { orderId: target.id } : { bookingId: target.id };
      const r = await undoCardMatchInBackOffice(member.id, ref, unlink).catch(() => ({ ok: false as const, error: "Couldn't undo it. Try again." }));
      if (!r.ok) setCardError(r.error);
      else setRefunded(`${target.label}: ${r.message}`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Purchase history</h2>
      {refunded && <div className="notice notice-success mb-3 !p-3 text-sm">{refunded}</div>}
      {cardError && <div className="notice notice-warn mb-3 !p-3 text-sm">{cardError}</div>}
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
                {p.cardLabel ? ` · ${p.cardLabel}` : p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
              </span>
              {p.cardHow && (
                <span
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
                  title={
                    p.cardHow === "card"
                      ? "Nobody was attached, so the card that paid gave them the points. They see only the points, not what was bought."
                      : p.cardHow === "picked"
                        ? "The card that paid is on more than one account, and the cashier picked this member."
                        : "Given to this member at the register after a card match was undone."
                  }
                >
                  {p.pointsOnly ? "Points only, by card" : "Points by card"}
                </span>
              )}
              {p.cardHow && canUndoCardMatch && p.status !== "refunded" && (
                <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" disabled={cardBusy} onClick={() => setUndoTarget(p)}>
                  Someone else paid
                </button>
              )}
              {p.canLinkCard && canUndoCardMatch && (
                <button
                  className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                  disabled={cardBusy}
                  title={`Link the card that paid, if ${who} asks: then a sale on it with nobody attached earns their points.`}
                  onClick={() => setLinkTarget(p)}
                >
                  Link this card
                </button>
              )}
              {p.status === "refunded" ? (
                <span className="rounded-full border border-[var(--danger-text)] px-2 py-0.5 text-xs text-[var(--danger-text)]">Refunded</span>
              ) : p.total > 0 && !p.pointsOnly ? (
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
            const r = refundTarget.kind === "order" ? await refundOrder(refundTarget.id, pin) : await refundBooking(refundTarget.id, pin);
            if (!r.ok) throw new Error(r.error); // shown in the PIN box
            setRefunded(`Refunded "${refundTarget.label}". ${approvalText(r)}`);
            setRefundTarget(null);
            router.refresh();
          }}
        />
      )}

      {undoTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-sm text-center shadow-2xl">
            <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
              Take these points back from {who}?
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {undoTarget.label} was paid with {undoTarget.cardLabel ?? "a card"}, and nobody was attached, so its points went to {who}.
              {undoTarget.kind === "order" ? " Taking them back also takes the sale off their account." : ""}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {undoTarget.cardHow === "card" ? (
                <>
                  <button className="btn-secondary" onClick={() => undo(undoTarget, false)}>
                    Someone else paid with {who}&apos;s card (keep it linked)
                  </button>
                  <button className="btn-secondary" style={{ color: "var(--danger-text)" }} onClick={() => undo(undoTarget, true)}>
                    It isn&apos;t {who}&apos;s card (unlink it too)
                  </button>
                </>
              ) : (
                <button className="btn-secondary" style={{ color: "var(--danger-text)" }} onClick={() => undo(undoTarget, false)}>
                  Take them back
                </button>
              )}
              <button className="btn-secondary" onClick={() => setUndoTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {linkTarget && (
        <ConfirmModal
          title={`Link ${linkTarget.cardLabel ?? "this card"}?`}
          description={`Only if ${who} asks. Then a sale paid with it, with nobody attached, earns ${who}'s points. Cards link on their own once they've paid for ${who} on 2 different days.`}
          confirmLabel="Link it"
          onCancel={() => setLinkTarget(null)}
          onConfirm={() => {
            const target = linkTarget;
            setLinkTarget(null);
            setCardError(null);
            startCard(async () => {
              const r = await linkCardFromSale(member.id, target.id).catch(() => ({ ok: false as const, error: "Couldn't link it. Try again." }));
              if (!r.ok) setCardError(r.error);
              else setRefunded(r.message ?? "Linked.");
              router.refresh();
            });
          }}
        />
      )}
    </div>
  );
}

// The cards linked to this member (lib/member-cards.ts): paying with one
// earns their points even when nobody attaches them at the register. Any
// staff can unlink one; it then stops finding them and isn't linked to
// them again on its own. A manager can link a removed one again.
function LinkedCardsCard({ member, cards, canRelink }: { member: Member; cards: MemberCard[]; canRelink: boolean }) {
  const [pending, run, error] = useRefreshingAction();
  const [note, setNote] = useState<string | null>(null);
  const [relinkTarget, setRelinkTarget] = useState<MemberCard | null>(null);
  const active = cards.filter((c) => !c.removedAt);
  const removed = cards.filter((c) => c.removedAt);
  const who = firstName(member.name);
  const day = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const how = (c: MemberCard) =>
    c.source === "online"
      ? "buying tickets online, signed in"
      : c.source === "plus"
        ? "from their Insiders+ billing"
        : c.source === "staff"
          ? `by a manager${c.linkedBy ? ` (${c.linkedBy})` : ""}`
          : `at the register${c.linkedBy ? ` (${c.linkedBy})` : ""}`;
  const relink = (c: MemberCard) =>
    run(async () => {
      setNote(null);
      const r = await relinkMemberCard(member.id, c.id);
      if (r.ok && r.message) setNote(r.message);
      return r;
    });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-1 text-lg font-semibold">
        Linked cards <InfoTip topic="card-linked-points" />
      </h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        A sale paid with one of these, with nobody attached, earns {who}&apos;s points ({who} sees only the points, not what was bought). We keep
        each card&apos;s type, last four digits and Stripe&apos;s code for recognizing it, never the card number.
        {member.link_cards === false && <strong> They turned card linking off, so these aren&apos;t used.</strong>}
      </p>
      {active.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No cards linked. A card links when it pays for {who} with their account attached on 2 different days, when they buy tickets online signed
          in, or from their Insiders+ billing.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {active.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-semibold">{c.label}</span>
              {c.test && <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">Test card</span>}
              <span className="text-xs text-[var(--muted)]">
                Linked {day(c.linkedAt)} {how(c)}
                {c.lastUsedAt ? ` · last used ${day(c.lastUsedAt)}` : ""}
                {` · ${c.sales} sale${c.sales === 1 ? "" : "s"}`}
                {c.wallet ? " · a phone or watch (its own card)" : ""}
              </span>
              <button className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50" disabled={pending} onClick={() => run(() => unlinkMemberCard(member.id, c.id), { quiet: true })}>
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
      {note && <p className="mt-2 text-sm text-[var(--muted)]">{note}</p>}
      {removed.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-[var(--muted)]">
            {removed.length} removed card{removed.length === 1 ? "" : "s"} (not linked again on their own; only Stripe&apos;s code for each is kept)
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
            {removed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {c.label}: removed {day(c.removedAt as string)}
                  {c.removedByMember ? " by the member" : c.removedBy ? ` by ${c.removedBy}` : ""}
                </span>
                {canRelink && (
                  <button
                    className="rounded border border-[var(--border)] px-2 py-0.5 text-xs disabled:opacity-50"
                    disabled={pending}
                    title={c.removedByMember ? "They removed it themselves: only link it again if they ask" : undefined}
                    onClick={() => (c.removedByMember ? setRelinkTarget(c) : relink(c))}
                  >
                    Link again
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {relinkTarget && (
        <ConfirmModal
          title="Link it again?"
          description={`${who} removed this card from their account themselves. Link it again only if they asked.`}
          confirmLabel="Link it again"
          onCancel={() => setRelinkTarget(null)}
          onConfirm={() => {
            const c = relinkTarget;
            setRelinkTarget(null);
            relink(c);
          }}
        />
      )}
    </div>
  );
}

// Two accounts for one person (often an old-site account plus one the door
// tablet made): fold the other into this one. The merge page shows both
// side by side and exactly what happens before anything changes. Owner and
// admin only.
function MergeDuplicateCard({ member }: { member: Member }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Merge a duplicate into this account</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        If {member.name} has a second account, its visits, points, orders and tickets can come over to this one, and the other account is deleted.
      </p>
      <Link href={`/admin/members/${member.id}/merge`} className="mt-3 inline-block rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--foreground)]">
        Find the duplicate…
      </Link>
    </div>
  );
}

// For deletion requests (the promise on /data-deletion): cancels Stripe
// billing, deletes their login, and clears their details everywhere they
// were copied, keeping anonymous purchase records for taxes. Admin only,
// behind a type-to-confirm step.
function RemovePersonalInfo({
  member,
  purchaseCount,
  isStaffLogin,
  viewerIsAdmin,
}: {
  member: Member;
  purchaseCount: number;
  isStaffLogin: boolean;
  viewerIsAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The day they asked, logged with the removal: /data-deletion promises
  // it's done within 30 days of the request.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [askedOn, setAskedOn] = useState(today);
  const subscribed = !!member.stripe_subscription_id && ["active", "trialing", "past_due"].includes(member.subscription_status ?? "");
  const points = Math.floor(Number(member.points));

  return (
    <div className="rounded-xl border border-red-200 bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--danger-text)]">Remove personal info</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        For when a member asks to be deleted. This does what the site&apos;s{" "}
        <a href="/data-deletion" className="underline" target="_blank" rel="noreferrer">
          Deleting your data
        </a>{" "}
        page promises.
      </p>

      {!viewerIsAdmin ? (
        <p className="mt-3 text-sm text-[var(--muted)]">Only an admin or the owner can do this.</p>
      ) : isStaffLogin ? (
        <p className="mt-3 text-sm text-[var(--danger-text)]">
          This member is also an active staff login. Remove their staff access in Admin → Staff first.
        </p>
      ) : !open ? (
        <button
          className="mt-3 rounded border border-[var(--danger-text)] px-3 py-1.5 text-sm text-[var(--danger-text)]"
          onClick={() => {
            setOpen(true);
            setTyped("");
            setAskedOn(today);
            setError(null);
          }}
        >
          Remove this member&apos;s personal info…
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-lg border border-[var(--border)] p-4">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Deletes their name, email, phone, photo and email preferences.</li>
            <li>
              Deletes their {points} point{points === 1 ? "" : "s"} and their points history.
            </li>
            {member.auth_user_id && <li>Deletes their website login (password, Google or Facebook).</li>}
            {subscribed && (
              <li>
                <strong>Cancels their Insiders+ in Stripe right away</strong> and removes their saved card. No refund is issued automatically.
              </li>
            )}
            {member.stripe_customer_id && <li>Clears their name, email and phone in Stripe. Stripe keeps the payment records, for taxes.</li>}
            <li>
              {purchaseCount > 0
                ? `Keeps their ${purchaseCount} purchase${purchaseCount === 1 ? "" : "s"} for taxes and refunds, shown as "Removed member".`
                : "They have no purchases, so nothing else is kept except an empty placeholder."}
            </li>
            <li>
              Also clears their name and contact details from ticket, booth and private-event bookings, gift memberships, bar tabs and custom
              items on their orders, their profile line, shared profile page and check-in effect, and the old-site copy.
            </li>
          </ul>
          <label className="block text-sm">
            Day they asked
            <input
              type="date"
              className="mt-1 block w-48 rounded border border-[var(--border)] px-2 py-1.5 text-sm"
              value={askedOn}
              max={today}
              onChange={(e) => setAskedOn(e.target.value)}
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">Logged with the removal. We promise it&apos;s done within 30 days of the request.</span>
          </label>
          <p className="text-sm font-bold">This can&apos;t be undone.</p>
          <label className="block text-sm">
            Type <strong>DELETE</strong> to confirm
            <input
              id="erase-confirm"
              className="mt-1 block w-48 rounded border border-[var(--border)] px-2 py-1.5 text-sm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-[var(--danger-text)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              disabled={pending || typed.trim() !== "DELETE" || !askedOn}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const r = await eraseMemberPersonalInfo(member.id, askedOn).catch(() => ({ ok: false as const, error: "Something went wrong. Nothing may have changed; try again." }));
                  if (!r.ok) {
                    setError(r.error);
                    return;
                  }
                  const warn = r.summary.warning ? `&warn=${encodeURIComponent(r.summary.warning)}` : "";
                  router.push(`/admin/members?removed=1${warn}`);
                  router.refresh();
                });
              }}
            >
              {pending ? "Removing…" : "Remove personal info"}
            </button>
            <button className="text-sm text-[var(--muted)] hover:underline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
