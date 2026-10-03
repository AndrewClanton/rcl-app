"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmModal from "@/components/ConfirmModal";
import MemberAvatar from "@/components/MemberAvatar";
import InfoTip from "@/components/help/InfoTip";
import { RATE_LABEL, RATE_ORDER, RATE_PRICE } from "@/lib/membership-rates";
import type { MemberPriceTier } from "@/lib/types";
import { addPosMemberEmail, addPosMemberName, searchPosMembers, setPosMemberRate, type PosMember } from "./member-actions";
import { cleanEmail, firstNameOf } from "@/lib/checkin";
import { maskEmail, setupName } from "@/lib/registerChannel";
import { useTabletMirror } from "./tablet-setup";
import { PhoneOnlyTag } from "./RegisterCheckins";
import { getMemberRewards, redeemMemberReward, undoMemberReward } from "./checkin-actions";
import type { OpenReward } from "@/lib/visits-server";
import { coffeeTime, type DailyCoffeeState } from "@/lib/daily-perk";
import LegacyPlusCard, { NOT_ACTIVE_RED, NotActiveStamp, type TabletSend } from "./LegacyPlusCard";
import { memberSignal, memberStanding } from "./member-signal";
import MemberGlance, { HOLD_CLASS, useLongPress } from "./MemberGlance";

// An Insiders+ member's free daily coffee today, as the register knows it
// (PosApp): undefined while it's looked up, null if it couldn't be.
export interface PanelCoffee {
  today: DailyCoffeeState | null | undefined;
  onOrder: boolean;
  retry: () => void;
}

const SIGNED_OUT = "The register couldn't reach the server. Check the connection, or sign in again if it has been a while.";

// The member on the order checked in on the customer screen
// (RegisterCheckins): it went through there (its visit and points), so
// this just says so. Nothing to reverse here (Andrew, 10/2): hold their
// name to flag the account instead (MemberGlance).
export interface VisitWaiting {
  auto: boolean; // the check-in put them on the order by itself
  line?: string; // "+5 pts · 140 pts · 🔥 3 weeks"
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

// Who set a senior/student rate, and when. No "set by" means it came over
// from the old website.
function rateSource(m: PosMember) {
  if (!m.price_tier || m.price_tier === "adult") return null;
  if (m.price_tier_set_by_name && m.price_tier_set_at) return `${m.price_tier_set_by_name}, ${shortDate(m.price_tier_set_at)}`;
  return m.price_tier_set_at ? shortDate(m.price_tier_set_at) : "from old site";
}

function confirmCopy(m: PosMember, tier: MemberPriceTier) {
  const price = RATE_PRICE[tier];
  const billing = m.subscribed
    ? `Their Insiders+ bill becomes $${price}/mo starting with their next bill. Nothing is charged today.`
    : m.tier === "Insiders+" && m.comped
      ? "Their Insiders+ is comped, so billing doesn't change."
      : `If they join Insiders+, they'll pay $${price}/mo.`;
  if (tier === "adult") return `Back to the standard rate. ${billing}`;
  const proof = tier === "senior" ? "an ID showing their age" : "a current student ID";
  return `Only after checking ${proof}. ${billing}`;
}

export default function PosMemberPanel({
  member,
  onChange,
  coffee,
  employeeId,
  onRewardLine,
  onFind,
  readerId,
  toTablet,
  visit = null,
}: {
  member: PosMember | null;
  onChange: (m: PosMember | null) => void;
  // Set for an Insiders+ member: their free daily coffee today.
  coffee: PanelCoffee | null;
  employeeId: string;
  // Puts a redeemed badge reward on the order as a $0 line.
  onRewardLine: (label: string) => void;
  // "Find by photo": opens the Customers tab beside the menu, at its faces.
  onFind: () => void;
  // For setting up Insiders+ here (LegacyPlusCard: no card on file, or an
  // upgrade): this register's card reader, and the customer screen.
  readerId: string | null;
  toTablet: TabletSend;
  visit?: VisitWaiting | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [confirmTier, setConfirmTier] = useState<MemberPriceTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held for half a second, their name shows their account (MemberGlance).
  const [glance, setGlance] = useState(false);
  const hold = useLongPress();
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = await searchPosMembers(q).catch(() => null);
      if (ticket !== latest.current) return;
      setSearching(false);
      setResults(found ?? []);
      setError(found ? null : SIGNED_OUT);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function attach(m: PosMember | null) {
    onChange(m);
    setQuery("");
    setResults([]);
    setRateOpen(false);
    setMessage(null);
    setError(null);
  }

  // A QR scanner types the code and presses Enter faster than the debounce,
  // so Enter searches immediately and attaches a single match.
  async function onEnter() {
    const q = query.trim();
    if (q.length < 2) return;
    const ticket = ++latest.current;
    const found = await searchPosMembers(q).catch(() => null);
    if (ticket !== latest.current) return;
    setSearching(false);
    if (!found) return setError(SIGNED_OUT);
    if (found.length === 1) attach(found[0]);
    else setResults(found);
  }

  async function applyRate(tier: MemberPriceTier) {
    if (!member) return;
    setConfirmTier(null);
    setBusy(true);
    setMessage(null);
    setError(null);
    const r = await setPosMemberRate(member.id, tier, employeeId || null).catch(() => null);
    setBusy(false);
    if (!r) return setError(SIGNED_OUT);
    if (!r.ok) return setError(r.error);
    if (r.member) onChange(r.member);
    setMessage(r.message);
    setRateOpen(false);
  }

  const rate: MemberPriceTier = member?.price_tier ?? "adult";
  const standing = member ? memberStanding(member) : null;
  const source = member ? rateSource(member) : null;
  const showNoMatch = query.trim().length >= 2 && !searching && !error && results.length === 0;

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="eyebrow mb-2">Member</div>

      {member ? (
        // Edged in gold for paying Insiders+, red for a former unlimited
        // member who isn't paying or Insiders+ with no card on file
        // (member-signal.ts), like the order above.
        <div
          className={`rounded-lg p-2.5 text-sm ${standing === "insiders" ? "border" : "border-2"}`}
          style={{ borderColor: standing === "plus" ? "var(--gold)" : standing === "insiders" ? "var(--border)" : "var(--accent)" }}
        >
          {visit && (
            <div className="-mx-2.5 -mt-2.5 mb-2.5 flex items-center gap-2 rounded-t-[7px] px-2.5 py-1.5" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }} role="status">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-bold">📲 Checked in on the screen{visit.auto ? " · on this order" : ""}</span>
                {visit.line && <span className="block truncate text-xs tabular-nums">{visit.line}</span>}
              </span>
            </div>
          )}
          <div className={`flex items-center gap-3 ${HOLD_CLASS}`} {...hold(() => setGlance(true))}>
            <MemberAvatar name={member.name} url={member.avatar_url} size={44} plus={standing === "plus"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{member.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>
                  {member.phoneOnly && <PhoneOnlyTag />}
                  {member.tier}
                </span>
              </div>
              {(member.email || member.phone) && (
                <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                  {member.email ?? member.phone}
                </div>
              )}
            </div>
          </div>

          {/* A former unlimited member who isn't paying: the ways to set it
              up are on the red banner across the top of the order. */}
          {member.legacyUnlimited ? (
            <div className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-bold leading-snug text-white" style={{ background: NOT_ACTIVE_RED }}>
              <NotActiveStamp />
              <span className="min-w-0 flex-1">Unlimited: no payment on file. Set it up at the top of the order.</span>
            </div>
          ) : (
            // Insiders+ with nothing paying for it: the red "no card on file"
            // card, also up on the customer screen. Plain Insiders: an
            // upgrade, folded away. Paid-for Insiders+ (a subscription,
            // complimentary, or a gifted year): nothing to set up.
            (standing === "nocard" || (standing === "insiders" && !member.subscribed && !member.comped)) && (
              <LegacyPlusCard
                key={`unlimited-${member.id}`}
                kind={standing === "nocard" ? "nocard" : "upgrade"}
                member={member}
                readerId={readerId}
                employeeId={employeeId}
                toTablet={toTablet}
                onDone={(m) => {
                  onChange(m);
                  setMessage(`${firstNameOf(m.name)} is Insiders+ now.`);
                }}
              />
            )
          )}
          {(member.named === false || !member.email) && (
            <AddDetails
              key={`add-${member.id}`}
              member={member}
              onSaved={(m, msg) => {
                onChange(m);
                setMessage(msg);
                setError(null);
              }}
            />
          )}
          {member.tagline && <div className="mt-2 text-xs italic">“{member.tagline}”</div>}
          {coffee && <CoffeeToday coffee={coffee} />}
          <MemberRewards key={member.id} memberId={member.id} onRewardLine={onRewardLine} />

          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span>
              Rate: <strong>{RATE_LABEL[rate]}</strong>
              {source && <span style={{ color: "var(--muted)" }}> · {source}</span>}
              <InfoTip topic="senior-student-rates" />
            </span>
            <button className="hover:underline" style={{ color: "var(--accent)" }} onClick={() => setRateOpen((o) => !o)} disabled={busy}>
              {rateOpen ? "Close" : "Change rate"}
            </button>
          </div>

          {rateOpen && (
            <div className="mt-2">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                Senior and student rates need an ID checked in person.
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {RATE_ORDER.map((t) => (
                  <button
                    key={t}
                    className={`chip justify-center !px-1 py-2 text-xs ${t === rate ? "chip-selected" : ""}`}
                    disabled={t === rate || busy}
                    onClick={() => setConfirmTier(t)}
                  >
                    {RATE_LABEL[t]} ${RATE_PRICE[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {busy && (
            <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Updating…
            </div>
          )}
          {message && <div className="notice notice-success mt-2 p-2 text-xs">{message}</div>}
          {error && (
            <div className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>
              Loyalty points: {Math.round(member.points)}
              <InfoTip topic="points-and-badges" />
            </span>
            <button className="hover:underline" style={{ color: "var(--accent)" }} onClick={() => attach(null)} disabled={busy}>
              Remove member
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center">
            <button type="button" className="btn-secondary flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 !py-2 text-sm" onClick={onFind}>
              Find by photo
            </button>
            {/* Scanning a member card or online ticket works anywhere on the register. */}
            <InfoTip topic="door-scanner" />
          </div>
          <input
            className="input"
            placeholder="Name, email, phone, or scan their QR"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearching(e.target.value.trim().length >= 2);
              if (e.target.value.trim().length < 2) setResults([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              }
            }}
          />
          {results.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              {results.map((m) => (
                <button key={m.id} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]" onClick={() => attach(m)}>
                  <MemberAvatar name={m.name} url={m.avatar_url} size={28} plus={memberSignal(m) === "plus"} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{m.name}</span>
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      — {m.tier}
                      {m.price_tier && m.price_tier !== "adult" ? ` · ${RATE_LABEL[m.price_tier]}` : ""}
                    </span>
                    {(m.email || m.phone) && (
                      <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                        {[m.email, m.phone].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="mt-1 text-xs" style={{ color: "var(--danger-text)" }}>
              {error}
            </div>
          )}
          {showNoMatch && (
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              No member matches that.
            </div>
          )}
          <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            Loyalty points: — (attach a member)
          </div>
        </>
      )}

      {member && glance && <MemberGlance key={member.id} member={member} employeeId={employeeId} onClose={() => setGlance(false)} />}

      {member && confirmTier && (
        <ConfirmModal
          title={`Switch ${firstNameOf(member.name)} to ${RATE_LABEL[confirmTier]}?`}
          description={confirmCopy(member, confirmTier)}
          confirmLabel={confirmTier === "adult" ? "Switch to Adult" : "ID checked, switch"}
          onConfirm={() => applyRate(confirmTier)}
          onCancel={() => setConfirmTier(null)}
        />
      )}
    </div>
  );
}

// "Add name" / "Add email" for an account missing one: a phone account
// (lib/member-name.ts) whose guest wants their name on it, or an email to
// sign in on the website. Adding only: changing what's there is Back
// office's job. The customer screen follows along as it's typed (the name
// as a first name and last initial, the email masked), and the guest's
// "✓ That's right" there saves it (tablet-setup.tsx).
function AddDetails({ member, onSaved }: { member: PosMember; onSaved: (m: PosMember, message: string) => void }) {
  const [open, setOpen] = useState<"name" | "email" | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = open === "name" ? !!first.trim() : !!cleanEmail(email);
  // The guest's "✓ That's right" on the customer screen saves it too.
  const tablet = useTabletMirror(
    open !== null,
    open === "email" ? { what: "email", email: maskEmail(email), ready, hold: !!error } : { what: "name", name: setupName(first, last), ready, hold: !!error },
    () => void save(),
  );
  const mirrored = tablet.mirrored;

  async function save() {
    if (busy || !open || !ready) return;
    setBusy(true);
    setError(null);
    const r =
      open === "name"
        ? await addPosMemberName(member.id, { firstName: first, lastName: last }).catch(() => null)
        : await addPosMemberEmail(member.id, { email, optIn }).catch(() => null);
    setBusy(false);
    if (!r) return setError(SIGNED_OUT);
    if (!r.ok) return setError(r.error);
    tablet.saved();
    setOpen(null);
    onSaved(r.member, r.message);
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {member.named === false && (
          <button className="btn-secondary min-h-11 !px-3 !py-1 text-xs" onClick={() => setOpen("name")}>
            + Add name
          </button>
        )}
        {!member.email && (
          <button className="btn-secondary min-h-11 !px-3 !py-1 text-xs" onClick={() => setOpen("email")}>
            + Add email
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="mt-2 space-y-1.5 rounded-md border p-2"
      style={{ borderColor: "var(--border)" }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {open === "name" ? (
        <div className="grid grid-cols-[3fr_2fr] gap-1.5">
          <input
            className="input min-h-11 !py-1.5 text-sm"
            placeholder="First name"
            aria-label="First name"
            autoFocus
            maxLength={40}
            value={first}
            onChange={(e) => {
              setError(null);
              setFirst(e.target.value);
            }}
          />
          <input
            className="input min-h-11 !py-1.5 text-sm"
            placeholder="Last (optional)"
            aria-label="Last name or initial (optional)"
            maxLength={40}
            value={last}
            onChange={(e) => {
              setError(null);
              setLast(e.target.value);
            }}
          />
        </div>
      ) : (
        <>
          <input
            className="input min-h-11 !py-1.5 text-sm"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="their@email.com"
            aria-label="Their email"
            autoFocus
            maxLength={254}
            value={email}
            onChange={(e) => {
              setError(null);
              setEmail(e.target.value);
            }}
          />
          <label className="flex min-h-11 items-center gap-2 text-xs">
            <input type="checkbox" className="h-5 w-5" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            They want our emails (news and showtimes)
          </label>
        </>
      )}
      {error && (
        <div className="text-xs" style={{ color: "var(--danger-text)" }}>
          {error}
        </div>
      )}
      {mirrored && (
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          On the customer screen as you type{open === "email" ? " (masked)" : ""}: they can tap ✓ That&apos;s right.
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="submit" className="btn-primary min-h-11 flex-1 !py-1 text-xs" disabled={busy || !ready}>
          {busy ? "Saving…" : open === "name" ? "Save name" : "Save email"}
        </button>
        <button
          type="button"
          className="btn-secondary min-h-11 !px-3 !py-1 text-xs"
          disabled={busy}
          onClick={() => {
            setOpen(null);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// "Free coffee today: ready / used at 9:14 AM". It goes on the order by
// itself when a daily coffee item is rung (PosApp).
function CoffeeToday({ coffee }: { coffee: PanelCoffee }) {
  const { today, onOrder, retry } = coffee;
  return (
    <div className="mt-2 flex items-center gap-1 text-xs">
      <span className="min-w-0 flex-1">
        ☕ Free coffee today:{" "}
        {today === undefined ? (
          <span style={{ color: "var(--muted)" }}>checking…</span>
        ) : today === null ? (
          <>
            <span style={{ color: "var(--muted)" }}>couldn&apos;t check</span>{" "}
            <button className="hover:underline" style={{ color: "var(--accent)" }} onClick={retry}>
              Try again
            </button>
          </>
        ) : today.usedAt ? (
          <>
            <strong>used at {coffeeTime(today.usedAt)}</strong>
            {today.orderNumber !== null && <span style={{ color: "var(--muted)" }}> (#{today.orderNumber})</span>}
          </>
        ) : (
          <>
            <strong style={{ color: "var(--accent)" }}>ready</strong>
            {onOrder && <span style={{ color: "var(--muted)" }}> · on this order</span>}
          </>
        )}
      </span>
      <InfoTip topic="daily-coffee" className="!mx-0" />
    </div>
  );
}

// Badge rewards this member has earned and not used yet (a free popcorn
// with 13 weeks in a row, a free pizza with 26; see lib/visits.ts). Redeem
// marks it used and puts it on the order at $0; Undo gives it back if it
// was a mis-tap.
function MemberRewards({ memberId, onRewardLine }: { memberId: string; onRewardLine: (label: string) => void }) {
  const [rewards, setRewards] = useState<OpenReward[]>([]);
  const [used, setUsed] = useState<OpenReward[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMemberRewards(memberId)
      .then((r) => {
        if (live) setRewards(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [memberId]);

  if (!rewards.length && !used.length) return null;

  async function redeem(r: OpenReward) {
    setWorking(true);
    setError(null);
    const ok = await redeemMemberReward(r.id).catch(() => null);
    setWorking(false);
    if (ok === null) return setError("Couldn't reach the server. Try again.");
    setRewards((rs) => rs.filter((x) => x.id !== r.id));
    if (!ok) return setError("That reward was already used (maybe on the other register).");
    setUsed((u) => [...u, r]);
    onRewardLine(`${r.label} (badge reward)`);
  }

  async function undo(r: OpenReward) {
    setWorking(true);
    await undoMemberReward(r.id).catch(() => {});
    setWorking(false);
    setUsed((u) => u.filter((x) => x.id !== r.id));
    setRewards((rs) => [...rs, r]);
  }

  return (
    <div className="mt-2 space-y-1.5">
      {rewards.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-md border-2 px-2 py-1.5 text-xs" style={{ borderColor: "var(--foreground)", background: "var(--gold)", color: "var(--foreground)" }}>
          <span className="min-w-0 flex-1">
            🎁 <strong>{r.label}</strong> · {r.reason}
          </span>
          <button className="btn-primary shrink-0 !px-2.5 !py-1 !text-xs" disabled={working} onClick={() => redeem(r)}>
            Redeem
          </button>
        </div>
      ))}
      {used.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
          <span className="min-w-0 flex-1">
            ✓ {r.label} added to the order at $0.
          </span>
          <button className="shrink-0 hover:underline" disabled={working} onClick={() => undo(r)}>
            Undo (then remove the line)
          </button>
        </div>
      ))}
      {error && (
        <div className="text-xs" style={{ color: "var(--danger-text)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
