"use client";

import { useState } from "react";
import { LEGACY_DEFAULT_INTERVAL, LEGACY_DEFAULT_RATE } from "@/lib/legacy-plus";
import { planPrice } from "@/lib/membership-rates";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { BADGES, badgeFor, type Badge } from "@/lib/visits";
import { FLAIR_EFFECTS, flairColor } from "@/lib/flair";
import { cleanDisplayName, lineFromChannel } from "@/lib/member-profile";
import { SITE_URL } from "@/lib/site";
import type { RegisterCartSnapshot } from "@/lib/registerChannel";
import ClaimQr from "./ClaimQr";
import { CardFrame, NameLine } from "@/components/flair/CardLook";
import k from "./kiosk.module.css";
import sp from "./spend.module.css";

// "Spend points": opens the list (SpendPoints.tsx).
function SpendButton({ onSpend }: { onSpend: () => void }) {
  return (
    <button type="button" className={sp.open} onClick={onSpend}>
      🎁 Spend points
    </button>
  );
}

// The member on the order, on the customer screen (CustomerDisplay.tsx),
// from what the register broadcasts about them (lib/registerChannel.ts):
// - NeedsCardCard: a former unlimited member with nothing paying for it
//   (lib/legacy-plus.ts), or Insiders+ with no card on file. Red, never
//   gold: as a banner over the order, or filling the panel while there's
//   nothing rung up yet. Never over the order's total or the check-in
//   keypad, and never locks the screen: "✕ Show my card" (or a few seconds
//   untouched) puts it down for their own card, which then carries an "Add
//   a card" chip to bring it back (AddCardChip; Andrew 10/3). The register
//   keeps its red signal either way.
// - PlusWelcomeCard: the moment it's set up.
// - MemberCard: their card while nothing's rung up yet: photo, name,
//   profile line, color, badges and points, and what's left to make it
//   theirs on their account.
// - AccountPanel: the compact version beside the order: where they stand,
//   points and what they're worth, and their Insiders+ perks today.
// Every word and price is the screen's own; off the channel come only a
// first name, numbers, keys into the screen's catalogs, their display name
// and line (both tidied here), and a sealed photo reference.

export type TabletMember = NonNullable<RegisterCartSnapshot["member"]>;

// Gold only for Insiders+ that's paid for; red for unlimited and no card.
export type Standing = "plus" | "nocard" | "unlimited" | "insiders";

export function standingOf(m: TabletMember): Standing {
  if (m.unlimited) return "unlimited";
  if (m.noCard) return "nocard";
  return m.plus ? "plus" : "insiders";
}

// Red: "add your card" stays up beside the order.
export function needsCard(m: TabletMember | null | undefined): boolean {
  return !!m && (!!m.unlimited || !!m.noCard);
}

// "$15/month": the price staff set them up at unless they pick otherwise.
const PRICE = planPrice(LEGACY_DEFAULT_RATE, LEGACY_DEFAULT_INTERVAL);

// onDismiss: "✕ Show my card" (or "✕ Close" over the order): down until
// they tap the chip on their card. This screen only: the register's setup
// (a card waiting on the reader, say) carries on.
export function NeedsCardCard({ firstName, kind, hero, onDismiss }: { firstName: string; kind: "unlimited" | "nocard"; hero: boolean; onDismiss?: () => void }) {
  return (
    <section className={`${k.unlimited} ${hero ? k.unlimitedHero : ""}`} role="status" aria-live="polite">
      {onDismiss && (
        <button type="button" className={k.redClose} onClick={onDismiss}>
          <span aria-hidden="true">✕</span> {hero ? "Show my card" : "Close"}
        </button>
      )}
      <div className={k.unlimitedCopy}>
        <span className={k.notActive}>{kind === "nocard" ? "No card on file" : "Not active"}</span>
        <h2 className={k.unlimitedTitle}>
          {kind === "nocard" ? <>{firstName}, your Insiders+ has no card on file</> : <>{firstName}, your unlimited membership isn&apos;t active</>}
        </h2>
        <p className={k.unlimitedWhy}>
          {kind === "unlimited" && <>No card on file. </>}
          <b>Tap your card on the reader to {kind === "nocard" ? "keep it going" : "restart"}:</b>{" "}
          <span className={k.unlimitedPrice}>
            <b>{PRICE}</b> <span className={k.unlimitedTax}>+ tax</span>
          </span>
        </p>
        {hero && (
          <ul className={k.perks}>
            <li>🎬 Free movies</li>
            <li>10% off food &amp; drinks</li>
            <li>☕ A free coffee every day</li>
          </ul>
        )}
      </div>
      <TapIcon />
    </section>
  );
}

// A card with contactless waves: "tap here".
function TapIcon() {
  return (
    <svg className={k.tapIcon} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="18" width="34" height="24" rx="4" fill="#f8f5ec" stroke="#14110c" strokeWidth="3" />
      <rect x="11" y="24" width="8" height="6" rx="1.5" fill="#ffc72c" stroke="#14110c" strokeWidth="2" />
      <g className={k.tapWaves} stroke="#f8f5ec" strokeWidth="3.5" strokeLinecap="round">
        <path d="M46 22c3 3 4.6 6.4 4.6 10s-1.6 7-4.6 10" />
        <path d="M52 16c4.6 4.6 7 10 7 16s-2.4 11.4-7 16" />
      </g>
    </svg>
  );
}

// renewed: they already had Insiders+ (no card on file), so it keeps going
// rather than starting.
export function PlusWelcomeCard({ firstName, hero, renewed = false }: { firstName: string; hero: boolean; renewed?: boolean }) {
  return (
    <section className={`${k.plusWelcome} ${hero ? k.unlimitedHero : ""}`} role="status" aria-live="polite">
      <span className={k.plusSeal} aria-hidden="true">
        +
      </span>
      <div className={k.unlimitedCopy}>
        <h2 className={k.unlimitedTitle}>🎉 {firstName}, you&apos;re Insiders+!</h2>
        <p className={k.unlimitedWhy}>{renewed ? "Your card's on file. Free movies and 10% off keep going. Enjoy the show." : "Free movies and 10% off start right now. Enjoy the show."}</p>
      </div>
    </section>
  );
}

// On their card (or their account) once the red card's down: one tap
// brings it back, with what it costs and where to tap.
export function AddCardChip({ kind, onClick, small = false }: { kind: "unlimited" | "nocard"; onClick: () => void; small?: boolean }) {
  return (
    <button type="button" className={`${k.addCard} ${small ? k.addCardSmall : ""}`} onClick={onClick}>
      <span aria-hidden="true">💳</span> {kind === "nocard" ? "Add a card to keep Insiders+" : "Add a card for Insiders+"}
      <span aria-hidden="true"> ›</span>
    </button>
  );
}

// ---------- where they stand, points and perks ----------

function StandingChip({ standing }: { standing: Standing }) {
  if (standing === "plus")
    return (
      <span className={`${k.standing} ${k.standingPlus}`}>
        <span className={k.plusPillSeal} aria-hidden="true">
          +
        </span>
        Insiders+ · Active
      </span>
    );
  if (standing === "nocard") return <span className={`${k.standing} ${k.standingRed}`}>Insiders+ · No card on file</span>;
  if (standing === "unlimited") return <span className={`${k.standing} ${k.standingRed}`}>Unlimited · Not active</span>;
  return <span className={k.standing}>Insiders</span>;
}

function points(n: number) {
  return Math.max(0, Math.round(Number(n) || 0));
}

// What their points are worth: every 100 is $5 off (one reward an order).
function worth(n: number): string {
  const rewards = Math.floor(n / POINTS_PER_REWARD);
  if (rewards > 0) return `worth $${(rewards * REWARD_VALUE).toLocaleString("en-US")} off`;
  return `${POINTS_PER_REWARD - n} more for $${REWARD_VALUE} off`;
}

// Their Insiders+ perks today: the free coffee and the 10% (plain Insiders
// get points, no discount; a former unlimited member isn't Insiders+). With
// something rung up, a coffee on the order and the 10% are already among
// the savings, so only a coffee still to come (or already had) is said here.
function perksToday(m: TabletMember, standing: Standing, onOrder: boolean): string[] {
  if (standing !== "plus" && standing !== "nocard") return [];
  const out: string[] = [];
  if (m.coffee === "ready") out.push("☕ Free coffee today: ready");
  else if (m.coffee === "used") out.push("☕ Today's free coffee: used");
  const pct = Math.round(Number(m.discountPct) || 0);
  if (!onOrder && pct > 0 && pct <= 50) out.push(`${pct}% off your order`);
  return out;
}

// "Done" and "That's not me" under their card while nothing's rung up: either
// takes them off the order (the register's "member-off") and the screen goes
// back to normal. Nothing times it out while they're on the order. Once
// something's rung up they're buying, so only "That's not me" is offered,
// on their account at the foot of the order (AccountPanel onNotMe).
export function MemberActions({ onOff }: { onOff: (why: "done" | "not-me") => void }) {
  return (
    <div className={k.memberActions}>
      <button type="button" className={`${k.cta} ${k.memberDone}`} onClick={() => onOff("done")}>
        Done
      </button>
      <button type="button" className={`${k.ghost} ${k.memberNotMe}`} onClick={() => onOff("not-me")}>
        That&apos;s not me
      </button>
    </div>
  );
}

// Beside the order (`earn`: the points this order earns), or on its own
// under a red card or tonight's tickets while nothing's rung up yet.
// onAddCard: their red card is down; the chip brings it back.
export function AccountPanel({
  member,
  earn,
  alone = false,
  onNotMe,
  onAddCard,
  onSpend,
}: {
  member: TabletMember;
  earn?: number;
  alone?: boolean;
  onNotMe?: () => void;
  onAddCard?: () => void;
  onSpend?: () => void;
}) {
  const standing = standingOf(member);
  const pts = points(member.points);
  const perks = perksToday(member, standing, !alone);
  return (
    <section className={`${k.account} ${alone ? k.accountAlone : ""} ${standing === "plus" ? k.accountPlus : ""}`} aria-label={`${member.firstName}'s account`}>
      <div className={k.accountInfo}>
        <div className={k.accountTop}>
          {alone && <span className={k.accountName}>{member.firstName}</span>}
          <StandingChip standing={standing} />
          <span className={k.accountPoints}>
            <b>{pts.toLocaleString("en-US")}</b> points <span className={k.accountWorth}>· {worth(pts)}</span>
          </span>
        </div>
        {perks.length > 0 && <div className={k.accountPerks}>{perks.join(" · ")}</div>}
        {onAddCard && (standing === "unlimited" || standing === "nocard") && <AddCardChip kind={standing} onClick={onAddCard} small />}
        {onSpend && <SpendButton onSpend={onSpend} />}
      </div>
      {!!earn && earn > 0 && (
        <div className={k.accountEarn}>
          <span className={k.earnBig}>+{earn}</span>
          <span className={k.accountEarnLabel}>this order</span>
        </div>
      )}
      {onNotMe && (
        <button type="button" className={k.accountNotMe} onClick={onNotMe}>
          That&apos;s not me
        </button>
      )}
    </section>
  );
}

// ---------- their card ----------

const ACCOUNT_URL = `${SITE_URL}/account`;
const ACCOUNT_LABEL = ACCOUNT_URL.replace(/^https:\/\/(www\.)?/, "");
const PHOTO_REF = /^[A-Za-z0-9_-]{40,200}$/;

// The outward-facing side of their profile, to them, while nothing's rung
// up yet: as their shared page would show it (lib/member-profile.ts), plus
// where they stand and their points, and what's still to do on their
// account's Profile tab. Without a profile (still looking it up, or it
// couldn't be read) it's their first name with the same account facts.
// onAddCard: their red "add your card" card is down; the chip brings it back.
export function MemberCard({ member, onAddCard, onSpend }: { member: TabletMember; onAddCard?: () => void; onSpend?: () => void }) {
  const p = member.profile ?? null;
  const standing = standingOf(member);
  const pts = points(member.points);
  const perks = perksToday(member, standing, false);
  const named = cleanDisplayName(p?.name);
  const name = (named.ok && named.value) || member.firstName;
  const line = lineFromChannel(p?.line);
  const color = flairColor(p?.color);
  const entrance = FLAIR_EFFECTS.find((e) => e.key === p?.entrance && e.key !== "classic") ?? null;
  const photo = typeof p?.photo === "string" && PHOTO_REF.test(p.photo) ? `/display/customer/photo/${p.photo}` : null;
  const badges = [...new Set(Array.isArray(p?.badges) ? p.badges : [])].map((key) => badgeFor(key)).filter((b): b is Badge => !!b);
  const todo = p?.todo;
  const steps = [
    todo?.photo && { icon: "📷", text: "Add a photo" },
    todo?.line && { icon: "✍️", text: "Write your profile line" },
    todo?.flair && { icon: "🎨", text: "Pick your color & entrance" },
  ].filter((s): s is { icon: string; text: string } => !!s);
  const look = p?.look ?? null;
  return (
    <CardFrame frame={look?.frame} color={color?.hex ?? "#ffc72c"}>
    <section
      className={`${k.memberCard} ${standing === "plus" ? k.memberCardPlus : ""}`}
      style={color ? ({ "--flair": color.hex } as React.CSSProperties) : undefined}
      aria-label={`${name}'s RCL card`}
    >
      <div className={k.cardTop}>
        <Photo url={photo} name={name} />
        <div className={k.cardWho}>
          <NameLine as="h2" className={k.cardName} name={name} nameColor={look?.nameColor} title={look?.title} />
          {line && <p className={k.cardLine}>“{line}”</p>}
          <div className={k.cardFacts}>
            <StandingChip standing={standing} />
            <span className={k.cardPoints}>
              <b>{pts.toLocaleString("en-US")}</b> points · {worth(pts)}
            </span>
          </div>
          {perks.length > 0 && <div className={k.cardPerks}>{perks.join(" · ")}</div>}
          {onAddCard && (standing === "unlimited" || standing === "nocard") && <AddCardChip kind={standing} onClick={onAddCard} />}
          {(color || entrance) && (
            <div className={k.cardFlair}>
              {color && (
                <span className={k.cardFlairBit}>
                  <span className={k.cardSwatch} aria-hidden="true" />
                  {color.label}
                </span>
              )}
              {entrance && <span className={k.cardFlairBit}>✨ {entrance.label} entrance</span>}
            </div>
          )}
        </div>
      </div>

      {p && (
        <div className={k.cardBadgesBox}>
          <div className={k.cardEyebrow}>
            Badges · {badges.length} of {BADGES.length}
          </div>
          {badges.length > 0 ? (
            <ul className={k.cardBadges}>
              {badges.map((b) => (
                <li key={b.key} className={k.badgeChip}>
                  <span className={k.chipEmoji} aria-hidden="true">
                    {b.emoji}
                  </span>
                  <span className={k.chipLabel}>{b.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={k.cardNoBadges}>They show up here as you earn them. Every check-in counts.</p>
          )}
        </div>
      )}

      <div className={k.cardNext}>
        <div className={k.cardNextCopy}>
          <div className={k.cardNextTitle}>{steps.length ? "Make it yours" : "Your card"}</div>
          <ul className={k.cardSteps}>
            {steps.map((s) => (
              <li key={s.text}>
                <span aria-hidden="true">{s.icon}</span> {s.text}
              </li>
            ))}
            {!onSpend && (
              <li className={k.cardSoon}>
                <span aria-hidden="true">🖼️</span> Card frames, sounds and more, unlocked with points
              </li>
            )}
          </ul>
          {onSpend && <SpendButton onSpend={onSpend} />}
          <div className={k.cardUrl}>{ACCOUNT_LABEL}</div>
        </div>
        <div className={k.cardQr}>
          <ClaimQr url={ACCOUNT_URL} size={92} label={`QR code: your account at ${ACCOUNT_LABEL}`} />
        </div>
      </div>
    </section>
    </CardFrame>
  );
}

// Their photo, or a silhouette (also if the photo doesn't load).
function Photo({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={k.cardPhoto}>
      {url && failed !== url ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the screen's own photo route, already sized
        <img src={url} alt={`${name}'s photo`} width={180} height={180} onError={() => setFailed(url)} />
      ) : (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="24" r="12" fill="currentColor" />
          <path d="M10 60c2-13 11-20 22-20s20 7 22 20z" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}
