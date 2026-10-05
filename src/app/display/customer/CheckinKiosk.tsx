"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  checkinTopic,
  cleanEmail,
  formatPhone,
  isFullPhone,
  phoneDigits,
  type CheckinConfirmed,
  type CheckinRequest,
  type PlusFinish,
  type PlusWelcome,
  type PointsEarned,
  type RewindFound,
  type TabletCheckin,
} from "@/lib/checkin";
import { RATE_PRICE } from "@/lib/membership-rates";
import { finishShown, type FinishShown } from "./FinishCard";
import {
  checkInNow,
  createKioskMember,
  createPhoneAccount,
  nameCheckin,
  startCheckin,
  startEmailCheckin,
  warmCheckin,
  type CheckinChoice,
  type CheckinFound,
  type CheckinPick,
} from "./actions";
import CheckinReward, { rewardFor, type RewardShown } from "./CheckinReward";
import LetterKeys, { type LetterKey } from "./LetterKeys";
import PointsCelebration from "./PointsCelebration";
import { badgeCheer, badgeFor, type Badge } from "@/lib/visits";
import type { CheckinTickets, TabletTicket } from "@/lib/door-tickets";
import type { TicketsShown } from "./TicketsCard";
import { isClaimUrl } from "@/lib/claim-link";
import ClaimQr from "./ClaimQr";
import FlairEffect from "@/components/flair/FlairEffect";
import { flairColor, flairHex, parseFlair, type EntranceKey, type StickerKey } from "@/lib/flair";
import { lineFromChannel } from "@/lib/member-profile";
import { isGuestName } from "@/lib/member-name";
import k from "./kiosk.module.css";
import { playSound } from "./sounds";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

export type CheckinStep =
  // "Phone or email": always there between check-ins. The number keypad,
  // or with `letters` the full keyboard (over the whole screen while it's
  // up). notFound: the number they typed that we don't know, formatted
  // ("Try your email?").
  | { name: "phone"; letters?: boolean; notFound?: string }
  // A number we don't know (formatted): "Just use my phone number" first,
  // then "Try my email" or the sign-up form. notThem: it's a shared family
  // number and they said "None of these".
  | { name: "notFound"; phone: string; notThem?: boolean }
  // A shared family number (Andrew, 10/2): "Which one is you?", a big
  // button per account ("Sarah M."), and "None of these". digits: the
  // number they typed.
  | { name: "pick"; choices: CheckinChoice[]; digits: string }
  // A phone account, made: "That's it — your phone number is your account."
  | { name: "phoneMade"; phone: string }
  // A phone account with no name, back for its second visit: "Add your
  // name?" once (skippable). digits: the number they typed.
  | { name: "askName"; request: CheckinRequest; digits: string }
  // Someone new: name and email, phone optional. missed: we looked up the
  // email they typed and didn't find it.
  | { name: "new"; missed?: boolean }
  // Found by email, no phone on file, and they typed a number first:
  // "Add this phone for one-tap check-in next time?" who: "Sarah M.".
  | { name: "found"; who: string; phone: string; request: CheckinRequest; withPhone: CheckinRequest; unlimited?: boolean }
  // Sent to the register; back to the keypad shortly. who: found by email
  // ("Welcome back, Sarah M.!"). unlimited: a former unlimited member with
  // no card on file here (lib/legacy-plus.ts), told their card goes on at
  // the register.
  | { name: "sent"; unlimited?: boolean; who?: string }
  // A new account, made. emailed: a setup link is on its way to them.
  | { name: "created"; firstName: string; claimUrl: string | null; emailed?: boolean };

// Confirmations land as banners across the top of the panel, so they
// never block the keypad for the next person. A new badge gets a banner of
// its own, a moment after the check-in's.
interface Toast {
  key: number;
  title: string;
  detail: string;
  tone: "ok" | "warn" | "badge";
  emoji: string | null; // a badge's, big beside the words
  // A member with no website login, confirmed by staff: a QR code to set
  // one up (only ever a link that passed isClaimUrl).
  claimUrl: string | null;
  // The check-in's: their profile line, and their favorite color (a hex
  // from lib/flair.ts's palette, never text off the channel).
  line?: string | null;
  color?: string | null;
}

// Badge banners follow the check-in's one at a time, and go quickly so the
// line keeps moving (a little longer when there's a free popcorn to ask for).
const BADGE_STAGGER_MS = 1100;
const BADGE_MS = 6000;
const BADGE_REWARD_MS = 10_000;

// A member's entrance over the whole screen (lib/flair.ts): `key` remounts
// it, `at` is when staff confirmed them.
// Their entrance again (CheckinKiosk `encore`): flair keys off their card.
export interface Encore {
  key: number;
  entrance: string | null;
  color: string | null;
}

interface Entrance {
  key: number;
  at: number;
  entrance: EntranceKey;
  color: string;
  sticker: StickerKey;
}
// Entrances waiting behind the one playing: at most this many, and none
// older than this (they've walked off by then).
const ENTRANCE_QUEUE = 3;
const ENTRANCE_STALE_MS = 10_000;

const OFFLINE = "We couldn't reach the register. Ask a staff member for help.";

// Half-finished screens clear themselves when someone walks away. The
// "no card on file" note for a former unlimited member stays long enough
// to read, and so does a "Welcome back" with their name. Walking away from
// "Add this phone?" checks them in without it (it was optional).
// Walking away from "Add your name?" checks them in without it too.
const TIMEOUT_MS: Record<CheckinStep["name"], number> = {
  phone: 0,
  notFound: 60_000,
  pick: 45_000,
  phoneMade: 15_000,
  askName: 60_000,
  new: 90_000,
  found: 20_000,
  sent: 2_800,
  created: 25_000,
};
const UNLIMITED_NOTE_MS = 12_000;
const WELCOME_BACK_MS = 4_000;
const timeoutFor = (step: CheckinStep) =>
  step.name === "sent" && step.unlimited ? UNLIMITED_NOTE_MS : step.name === "sent" && step.who ? WELCOME_BACK_MS : TIMEOUT_MS[step.name];
// Something typed and walked away from clears itself.
const IDLE_MS = 45_000;

// A request the register hasn't answered is resent until it has, and given
// up after this long (the sealed reference expires then anyway).
const OUTBOX_MS = 15 * 60_000;

// The first key wakes the server at most this often (warmCheckin); a reward
// still waiting on an answer after this long is taken down.
const WARM_EVERY_MS = 45_000;
const REWARD_WAIT_MS = 15_000;

// The number keypad. "email" switches to the full keyboard (LetterKeys).
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "email", "0", "back"];

// What's typed is a phone number while it's only digits, and an email
// once it has an @ or a letter in it.
const isEmailish = (s: string) => /[@a-z]/i.test(s);
const MAX_ENTRY = 100;

// The check-in half of the customer tablet: always "Phone or email", built
// for a line at the door, where nobody waits on the bartender.
// - Typing it is the check-in (Andrew, 10/2). The moment they tap "Check
//   in", the reward starts (CheckinReward.tsx: dim, an icon, then the
//   points it actually paid, or "Welcome back!" if they'd already checked
//   in today) while the server records the visit (display/customer/
//   actions.ts). The register hears about it as an opaque request, shows
//   staff who it is, puts them on the order (their card comes up beside
//   it) and offers Undo. A shared family number asks "Which one is you?"
//   here (first name and last initial only); the one they tap checks in
//   the same way, and "None of these" goes on as a number we don't know.
// - A number we don't know: "Just use my phone number" (a phone account,
//   checked in with it), "Try my email" (most members without a phone on
//   file have an email), or the sign-up form.
// - A known email checks in the same way. If their account has no phone
//   and they typed one first, they're asked first whether to add it for
//   next time ("Welcome back, Sarah M.!": first name and last initial only,
//   Andrew 10/1); it's saved with the check-in.
// - Someone new gives their name and email (phone optional): the account
//   is made right away (email marketing off) and checked in, then a QR
//   code to finish on their own phone, and the same link by email.
// - A known number or email that's a former unlimited member's with no
//   card on file here (lib/legacy-plus.ts) gets "Unlimited membership: no
//   card on file" and where to tap their card (Andrew, 10/1). The register
//   can then put a QR code up for them to add it on their phone.
// What comes back about them is a first name and points, their profile
// line, and their entrance in their color (lib/flair.ts; or a party in
// their birthday week), played once the reward's done, with a banner for
// each new badge. Never a login link from a typed number. When a sale with
// a member on it completes, the register says so and the points burst
// plays here.
// initialStep is for previews only.
// onTickets: someone's online tickets for today, after staff confirm their
// check-in. CustomerDisplay shows them beside the order, clear of the keypad.
// onRewind: Back office's Rewind just gave someone points for their visits
// before the new system ("Welcome back" plays here; streamers there).
// onFinish: a former unlimited member's "add your card on your phone" QR
// code from the register, or null to take it down (they paid, or staff
// took it down). CustomerDisplay shows it beside the order.
// onPlusWelcome: someone's Insiders+ was just set up at the register. True
// when CustomerDisplay celebrated it beside the order (they're the member
// on it); otherwise the banner here says so.
// home: bumped when they tap "Done" or "That's not me" under their card
// (CustomerDisplay): a "Thanks!" still up goes, back to the keypad.
// encore: their entrance again (a new `key` plays it), as they tap "Show my
// card" on the red "add your card" card. Not over one still playing.
export default function CheckinKiosk({
  registerTopic,
  home = 0,
  initialStep,
  onTickets,
  onRewind,
  onFinish,
  onPlusWelcome: onPlusWelcomeShown,
  encore,
}: {
  registerTopic: string;
  home?: number;
  initialStep?: CheckinStep;
  onTickets?: (shown: TicketsShown) => void;
  onRewind?: () => void;
  onFinish?: (shown: FinishShown | null) => void;
  onPlusWelcome?: (firstName: string) => boolean;
  encore?: Encore | null;
}) {
  const [step, setStep] = useState<CheckinStep>(initialStep ?? { name: "phone" });
  // "Phone or email", as typed.
  const [entry, setEntry] = useState("");
  // A number they tried that we don't know (ten digits): offered to add to
  // the account their email finds, or filled in on the new-account form.
  const [tried, setTried] = useState<string | null>(null);
  // A shared family number they said "None of these" to (ten digits): an
  // account made with it now is theirs too, instead of asking again.
  const [notThem, setNotThem] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [celebration, setCelebration] = useState<
    (Pick<PointsEarned, "firstName" | "earned" | "balance"> & { key: number; accent: string | null; headline?: string; detail?: string; long?: boolean }) | null
  >(null);
  // The member's entrance (lib/flair.ts), playing over the whole screen.
  // Two people confirmed close together (a couple at the door) each get
  // theirs in turn instead of the second cutting the first off: the rest
  // wait in `waiting` (playEntrance, nextEntrance).
  const [entrance, setEntrance] = useState<Entrance | null>(null);
  const entrancePlaying = useRef(false);
  const waiting = useRef<Entrance[]>([]);
  // Our own requests the register confirmed lately: their tickets (a
  // separate, later message) are ours to show; anyone else's aren't.
  const confirmedHere = useRef(new Map<string, number>());
  const channelRef = useRef<Channel | null>(null);
  // Requests sent to the register and not yet answered.
  const outbox = useRef(new Map<string, { request: CheckinRequest; seen: boolean; at: number }>());
  // Bumped on reset, so a lookup still in flight when the customer walks
  // away doesn't pop a screen back up.
  const session = useRef(0);
  // The check-in reward over the whole screen (CheckinReward.tsx), and what
  // follows it once it's gone.
  const [reward, setReward] = useState<RewardShown | null>(null);
  const afterReward = useRef<(() => void) | null>(null);
  // When the server was last woken (warmCheckin).
  const warmed = useRef(0);

  function send(event: string, payload: object) {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }

  function resetForm() {
    setEntry("");
    setTried(null);
    setNotThem(null);
    setFirstName("");
    setLastName("");
    setNewEmail("");
    setNewPhone("");
    setError(null);
  }

  function reset() {
    session.current += 1;
    resetForm();
    setStep({ name: "phone" });
  }

  // Their banner shows at once; only the entrance waits its turn. At most
  // ENTRANCE_QUEUE wait (the latest ones: they're the people still at the
  // screen), and one that's waited ENTRANCE_STALE_MS is skipped, so a
  // burst of confirmations never turns into a long show.
  function playEntrance(e: Omit<Entrance, "key" | "at">) {
    const next: Entrance = { ...e, key: Date.now() + Math.random(), at: Date.now() };
    if (!entrancePlaying.current) {
      entrancePlaying.current = true;
      setEntrance(next);
      return;
    }
    waiting.current = [...waiting.current, next].slice(-ENTRANCE_QUEUE);
  }

  // Their entrance again, from their card's flair keys (looked up in our
  // own catalog, as at check-in): never over one still playing.
  const playEncore = useEffectEvent((e: Encore) => {
    if (entrancePlaying.current) return;
    const party = e.entrance === "party";
    const flair = parseFlair({ color: e.color, effect: party ? "classic" : e.entrance });
    const show: EntranceKey = party ? "party" : flair.effect;
    if (show !== "classic") playEntrance({ entrance: show, color: flairHex(flair), sticker: flair.sticker });
  });
  const encoreKey = encore?.key ?? null;
  useEffect(() => {
    if (encoreKey && encore) playEncore(encore);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per key
  }, [encoreKey]);

  function nextEntrance() {
    const now = Date.now();
    waiting.current = waiting.current.filter((e) => now - e.at < ENTRANCE_STALE_MS);
    const next = waiting.current.shift() ?? null;
    entrancePlaying.current = !!next;
    setEntrance(next);
  }

  function toast(t: Omit<Toast, "key">, ms = 8_000) {
    const key = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { ...t, key }]);
    // A QR code stays up long enough to get a phone out (and to add a card).
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), t.claimUrl ? 25_000 : ms);
  }

  // "Add your card on your phone" (a former unlimited member, sent by the
  // register): beside the order, replacing any earlier one.
  const onFinishMessage = useEffectEvent((p: Partial<PlusFinish> | null) => {
    const shown = finishShown(p);
    if (shown) onFinish?.(shown);
  });

  const onFinishClose = useEffectEvent(() => onFinish?.(null));

  // Their Insiders+ is set up (on the reader, or on their phone).
  const onPlusWelcome = useEffectEvent((p: Partial<PlusWelcome> | null) => {
    if (!p || typeof p.firstName !== "string") return;
    onFinish?.(null);
    const name = p.firstName.slice(0, 40);
    if (onPlusWelcomeShown?.(name)) return;
    const title = isGuestName(name) ? "🎉 You're Insiders+!" : `🎉 ${name}, you're Insiders+!`;
    toast({ title, detail: "Unlimited movies are on. Enjoy the show.", tone: "ok", emoji: null, claimUrl: null }, 10_000);
  });

  // The register has it. One that's done here already (its visit recorded
  // and paid) needs nothing more from it.
  const onSeen = useEffectEvent((id: unknown) => {
    const item = typeof id === "string" ? outbox.current.get(id) : undefined;
    if (!item) return;
    item.seen = true;
    if (item.request.done) outbox.current.delete(item.request.id);
  });

  function ours(id: string) {
    confirmedHere.current.set(id, Date.now());
    for (const [x, at] of confirmedHere.current) if (Date.now() - at > 5 * 60_000) confirmedHere.current.delete(x);
  }

  // Confirmed by staff at a register (one from before shared numbers were
  // picked here, Andrew 10/2).
  const onConfirmed = useEffectEvent((p: Partial<CheckinConfirmed> | null) => {
    if (!p || typeof p.id !== "string" || typeof p.firstName !== "string") return;
    // Only our own requests (another screen's check-ins aren't ours to announce).
    if (!outbox.current.delete(p.id)) return;
    ours(p.id);
    cheer(p, true);
  });

  // A check-in's banner (withToast: confirmed by staff; a check-in done here
  // has had its reward instead), their entrance, and a banner for each
  // new badge.
  function cheer(p: Partial<CheckinConfirmed>, withToast: boolean) {
    if (typeof p.firstName !== "string") return;
    const name = p.firstName.slice(0, 40);
    const points = Math.max(0, Math.round(Number(p.points) || 0));
    const v = p.visit;
    const visitPoints = Math.max(0, Math.round(Number(v?.visitPoints) || 0));
    const weekStreak = Math.max(0, Math.round(Number(v?.weekStreak) || 0));
    // Only badges this screen knows, in its own words (never text off the
    // channel).
    const badges = v?.alreadyToday || !Array.isArray(v?.badges) ? [] : [...new Set(v.badges.map((b) => badgeFor(b?.key)).filter((b): b is Badge => !!b))].slice(0, 6);
    let detail: string;
    if (v?.alreadyToday) detail = `Already checked in today · ${points.toLocaleString("en-US")} points`;
    else if (v) detail = `+${visitPoints} points${weekStreak > 1 ? ` · 🔥 ${weekStreak} weeks in a row` : ""} · ${points.toLocaleString("en-US")} total`;
    else detail = `${points.toLocaleString("en-US")} points`;
    // Their flair: keys looked up in our own catalog (lib/flair.ts); their
    // line tidied and cut to length. The entrance never takes a tap.
    const f = p.flair && typeof p.flair === "object" ? p.flair : null;
    const party = f?.entrance === "party";
    const flair = parseFlair({ color: f?.color, effect: party ? "classic" : f?.entrance, sticker: f?.sticker });
    const show: EntranceKey = party ? "party" : flair.effect;
    // A phone account with no name (lib/member-name.ts) comes as "Guest ··
    // 0199": greeted without it, the last four in the detail so they know
    // it's theirs.
    const guest = isGuestName(name);
    if (withToast) {
      toast({
        title: guest ? (p.isNew ? "Welcome to the Royale!" : "✓ You're checked in") : p.isNew ? `Welcome to the Royale, ${name}!` : `✓ ${name}, you're checked in`,
        detail: guest ? `Phone ${name.replace(/^Guest /, "")} · ${detail}` : detail,
        tone: "ok",
        emoji: null,
        claimUrl: isClaimUrl(p.claimUrl) ? p.claimUrl : null,
        line: lineFromChannel(p.line),
        color: flair.color?.hex ?? null,
      });
    }
    if (show !== "classic") playEntrance({ entrance: show, color: flairHex(flair), sticker: flair.sticker });
    badges.forEach((b, i) => {
      const c = badgeCheer(b, guest ? "friend" : name);
      setTimeout(() => toast({ title: c.title, detail: c.detail, tone: "badge", emoji: c.emoji, claimUrl: null }, b.reward ? BADGE_REWARD_MS : BADGE_MS), BADGE_STAGGER_MS * (i + 1));
    });
  }

  const onTicketsMessage = useEffectEvent((p: Partial<CheckinTickets> | null) => {
    if (!p || typeof p.id !== "string" || typeof p.firstName !== "string" || !Array.isArray(p.tickets)) return;
    if (!confirmedHere.current.has(p.id)) return;
    const tickets = p.tickets
      .filter((t): t is TabletTicket => !!t && typeof t.title === "string" && typeof t.startsAt === "string")
      .slice(0, 4)
      .map((t) => ({
        title: t.title.slice(0, 80),
        posterUrl: typeof t.posterUrl === "string" && t.posterUrl.startsWith("https://") ? t.posterUrl : null,
        startsAt: t.startsAt,
        room: typeof t.room === "string" ? t.room.slice(0, 60) : "",
        quantity: Math.max(1, Math.round(Number(t.quantity) || 1)),
        status: t.status === "printed" ? ("printed" as const) : ("to_print" as const),
      }));
    if (!tickets.length) return;
    onTickets?.({ key: Date.now(), firstName: p.firstName.slice(0, 40), tickets });
  });

  // quiet: they said "That's not me" under the card themselves.
  const onDeclined = useEffectEvent((id: unknown, quiet: unknown) => {
    if (typeof id !== "string" || !outbox.current.delete(id) || quiet === true) return;
    toast({ title: "A check-in couldn't be confirmed", detail: "Please see the box office.", tone: "warn", emoji: null, claimUrl: null });
  });

  const onPoints = useEffectEvent((p: Partial<PointsEarned> | null) => {
    const earned = Math.round(Number(p?.earned));
    const balance = Math.round(Number(p?.balance));
    if (!p || typeof p.firstName !== "string" || !(earned > 0) || !Number.isFinite(balance)) return;
    setCelebration({
      // "Nice one, friend!" for a phone account with no name.
      firstName: isGuestName(p.firstName) ? "friend" : p.firstName.slice(0, 40),
      earned,
      balance: Math.max(0, balance),
      key: Date.now(),
      accent: flairColor(p.color)?.hex ?? null,
    });
  });

  // "Welcome back, Jane! We found 37 visits since March 2023. +412 points."
  const onRewindFound = useEffectEvent((p: Partial<RewindFound> | null) => {
    const earned = Math.round(Number(p?.earned));
    const balance = Math.round(Number(p?.balance));
    const visits = Math.round(Number(p?.visits));
    if (!p || typeof p.firstName !== "string" || !(earned > 0) || !Number.isFinite(balance)) return;
    const name = p.firstName.slice(0, 40);
    const since = typeof p.since === "string" && /^[A-Za-z]+ \d{4}$/.test(p.since) ? ` since ${p.since}` : "";
    setCelebration({
      firstName: name,
      earned,
      balance: Math.max(0, balance),
      key: Date.now(),
      accent: flairColor(p.color)?.hex ?? null,
      headline: `Welcome back, ${name}!`,
      detail: visits > 0 ? `We found ${visits.toLocaleString("en-US")} visit${visits === 1 ? "" : "s"}${since}.` : "We found your visits from before.",
      long: true,
    });
    onRewind?.();
  });

  // Joined, back after a dropped connection, or a register (re)joined:
  // either way the register may have missed requests, so send them again.
  const resendAll = useEffectEvent((onlyUnseen: boolean) => {
    const now = Date.now();
    for (const [id, item] of outbox.current) {
      if (now - item.at > OUTBOX_MS) outbox.current.delete(id);
      else if (!onlyUnseen || !item.seen) send("checkin-request", item.request);
    }
  });

  // Walked away from "Add this phone?" or "Add your name?": checked in
  // without it.
  const timeUp = useEffectEvent(() => (step.name === "found" ? choosePhone(false) : step.name === "askName" ? skipName() : reset()));

  // "Done" or "That's not me" under their card: back to the keypad from a
  // check-in's "Thanks!" (never from a form someone's filling in).
  const [homeSeen, setHomeSeen] = useState(home);
  if (home !== homeSeen) {
    setHomeSeen(home);
    if (step.name === "sent" || step.name === "phoneMade") {
      resetForm();
      setStep({ name: "phone" });
    }
  }

  useEffect(() => {
    const supabase = createClient();
    let channel: Channel | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      const ch = supabase.channel(checkinTopic(registerTopic));
      channel = ch;
      channelRef.current = ch;
      ch.on("broadcast", { event: "checkin-seen" }, (msg) => onSeen(msg.payload?.id))
        .on("broadcast", { event: "checkin-confirmed" }, (msg) => onConfirmed(msg.payload))
        .on("broadcast", { event: "checkin-declined" }, (msg) => onDeclined(msg.payload?.id, msg.payload?.quiet))
        .on("broadcast", { event: "checkin-tickets" }, (msg) => onTicketsMessage(msg.payload))
        .on("broadcast", { event: "checkin-sync" }, () => resendAll(false))
        .on("broadcast", { event: "points-earned" }, (msg) => onPoints(msg.payload))
        .on("broadcast", { event: "rewind" }, (msg) => onRewindFound(msg.payload))
        .on("broadcast", { event: "plus-finish" }, (msg) => onFinishMessage(msg.payload))
        .on("broadcast", { event: "plus-finish-close" }, () => onFinishClose())
        .on("broadcast", { event: "plus-welcome" }, (msg) => onPlusWelcome(msg.payload))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resendAll(false);
        });
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [registerTopic]);

  // The sounds for this side of the screen (sounds.ts): a question or a
  // card coming up, a gentle "hmm" for a number we don't know, an "uh-oh"
  // for an error, a chime or a sparkle for each banner, and the bigger
  // moments (points from a purchase or Rewind, a member's entrance).
  useEffect(() => {
    if (error) playSound("error");
  }, [error]);
  const stepName = step.name;
  useEffect(() => {
    if (stepName === "notFound") playSound("notFound");
    else if (stepName === "sent") playSound("chime");
    else if (stepName !== "phone") playSound("card");
  }, [stepName]);
  const lastToast = toasts.at(-1);
  const lastToastKey = lastToast?.key ?? null;
  const lastToastTone = lastToast?.tone ?? null;
  useEffect(() => {
    if (lastToastKey) playSound(lastToastTone === "badge" ? "badge" : lastToastTone === "warn" ? "error" : "chime");
  }, [lastToastKey, lastToastTone]);
  const celebrationKey = celebration?.key ?? null;
  const celebrationLong = !!celebration?.long;
  useEffect(() => {
    if (celebrationKey) playSound(celebrationLong ? "fanfare" : "checkin");
  }, [celebrationKey, celebrationLong]);
  const entranceKey = entrance?.key ?? null;
  useEffect(() => {
    if (entranceKey) playSound("confetti");
  }, [entranceKey]);

  // Until the register says it has a request, keep sending it: a broadcast
  // nobody was listening for is simply gone.
  useEffect(() => {
    const timer = setInterval(() => resendAll(true), 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const ms = timeoutFor(step);
    if (!ms) return;
    const timer = setTimeout(() => timeUp(), ms);
    return () => clearTimeout(timer);
  }, [step, firstName, lastName, newEmail, newPhone]);

  // A reward that never heard back (the connection dropped mid-way) doesn't
  // stay up: the lookup's own error shows when it comes.
  const rewardStuck = useEffectEvent(() => takeDown());
  useEffect(() => {
    if (!reward || reward.result || reward.leaving) return;
    const timer = setTimeout(() => rewardStuck(), REWARD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [reward]);

  // Something typed (or the full keyboard left up) and walked away from
  // clears itself, back to the keypad.
  useEffect(() => {
    if (step.name !== "phone" || (!entry && !step.letters)) return;
    const timer = setTimeout(() => timeUp(), IDLE_MS);
    return () => clearTimeout(timer);
  }, [step, entry]);

  function queue(request: CheckinRequest) {
    outbox.current.set(request.id, { request, seen: false, at: Date.now() });
    send("checkin-request", request);
  }

  // ---------- the reward (CheckinReward.tsx) ----------
  // It starts the moment they tap, before the server answers (startReward);
  // landed() gives it the points, or takeDown() takes it away without any
  // (a number we don't know, an error, a question to answer first).
  function startReward() {
    afterReward.current = null;
    setReward({ key: Date.now(), result: null });
  }

  function takeDown() {
    setReward((r) => (r ? { ...r, leaving: true } : r));
    setTimeout(() => setReward((r) => (r?.leaving ? null : r)), 260);
  }

  // Checked in: the register hears now (so their card is up beside the
  // order by the time the reward fades), the reward shows what it paid,
  // and once it's gone, `next` (a screen with more to say) and their
  // entrance and new badges. The keypad underneath is ready for the next
  // person.
  function landed(request: CheckinRequest, checkedIn: TabletCheckin | undefined, next: CheckinStep | null = null) {
    queue(request);
    if (checkedIn) ours(request.id);
    resetForm();
    setStep({ name: "phone" });
    afterReward.current = () => {
      if (next) setStep(next);
      if (checkedIn) cheer(checkedIn, false);
    };
    setReward((r) => ({ key: r?.key ?? Date.now(), result: rewardFor(checkedIn) }));
  }

  function rewardDone() {
    setReward(null);
    const then = afterReward.current;
    afterReward.current = null;
    then?.();
  }

  // A failed or abandoned lookup never leaves the reward waiting.
  function failed(message: string) {
    takeDown();
    setError(message);
  }

  const emailish = isEmailish(entry);
  const entryReady = emailish ? !!cleanEmail(entry) : isFullPhone(entry);
  const onKeypad = step.name === "phone" && !step.letters;

  function showLetters(letters: boolean) {
    setError(null);
    if (step.name === "phone") setStep({ ...step, letters });
  }

  // One entry for both keyboards: the keypad's digits stop at a phone
  // number's ten unless it's already an email. The first key wakes the
  // server (warmCheckin), so the check-in itself is quick.
  function type(text: string) {
    setError(null);
    if (!entry && Date.now() - warmed.current > WARM_EVERY_MS) {
      warmed.current = Date.now();
      void warmCheckin().catch(() => {});
    }
    setEntry((e) => {
      if (text === "@" && e.includes("@")) return e;
      const next = (e + text).toLowerCase();
      if (onKeypad && !isEmailish(next) && next.length > 10) return e;
      return next.slice(0, MAX_ENTRY);
    });
  }

  function press(key: string) {
    setError(null);
    playSound("key");
    if (key === "back") setEntry((e) => e.slice(0, -1));
    else if (key === "clear") setEntry("");
    else if (key === "email") showLetters(true);
    else type(key);
  }

  function pressLetter(key: LetterKey) {
    if (key === "digits") return showLetters(false);
    press(key);
  }

  // "@gmail.com" and the like: in place of whatever comes after their @.
  function domain(d: string) {
    setError(null);
    setEntry((e) => (e.split("@")[0] + d).toLowerCase().slice(0, MAX_ENTRY));
  }

  // "I'm new here": the form, with what they've typed so far filled in.
  function startNew(missed = false) {
    setError(null);
    if (isEmailish(entry)) setNewEmail(entry);
    const phone = tried ?? (isFullPhone(entry) ? entry : null);
    if (phone) setNewPhone(formatPhone(phone));
    setStep(missed ? { name: "new", missed: true } : { name: "new" });
  }

  // A former unlimited member with no card on file hears where their card
  // goes once the reward's done.
  const noCardNote = (unlimited: boolean | undefined): CheckinStep | null => (unlimited ? { name: "sent", unlimited: true } : null);

  // Found by email: checked in, or first "Add this phone?".
  function found(r: CheckinFound) {
    if (r.withPhone && r.phone) {
      takeDown();
      setStep({ name: "found", who: r.name, phone: r.phone, request: r.request, withPhone: r.withPhone, unlimited: r.unlimited });
      return;
    }
    landed(r.request, r.checkedIn, noCardNote(r.unlimited));
  }

  // A shared family number: "Which one is you?".
  function pickOne(r: CheckinPick, digits: string) {
    takeDown();
    setEntry("");
    setStep({ name: "pick", choices: r.choices, digits });
  }

  // "Which one is you?" answered: checked in like any other (the reward,
  // their card on the register, on the order).
  async function choose(c: CheckinChoice) {
    if (busy || step.name !== "pick") return;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    startReward();
    const r = await checkInNow(c.ref).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r || !r.ok) return failed(r?.error ?? OFFLINE);
    if ("status" in r) return pickOne(r, step.digits);
    landed(r.request, r.checkedIn, noCardNote(r.unlimited));
  }

  // "None of these": on as a number we don't know (their own phone
  // account, their email, or the sign-up form).
  function noneOfThese() {
    if (busy || step.name !== "pick") return;
    setError(null);
    setTried(step.digits);
    setNotThem(step.digits);
    setStep({ name: "notFound", phone: formatPhone(step.digits), notThem: true });
  }

  // "Add this phone?" answered (or walked away from): checked in now.
  async function choosePhone(add: boolean) {
    if (busy || step.name !== "found") return;
    const was = step;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    startReward();
    const r = await checkInNow((add ? was.withPhone : was.request).ref).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r || !r.ok) return failed(r?.error ?? OFFLINE);
    // Never for one account found by email; just in case.
    if ("status" in r) return failed(OFFLINE);
    landed(r.request, r.checkedIn, noCardNote(was.unlimited));
  }

  // "Check in →": the reward starts at once, while the server looks them up
  // and checks them in.
  async function lookUp() {
    if (busy || !entryReady) return;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    startReward();
    if (emailish) {
      const r = await startEmailCheckin({ email: entry, phone: tried }).catch(() => null);
      setBusy(false);
      if (ticket !== session.current) return takeDown();
      if (!r) return failed(OFFLINE);
      if (!r.ok) return failed(r.error);
      // Not one we know: make them an account (a typo can be fixed there,
      // and an email that's on an account is still found).
      if (r.status === "new") {
        takeDown();
        return startNew(true);
      }
      return found(r);
    }
    const digits = entry;
    const r = await startCheckin(digits).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r) return failed(OFFLINE);
    if (!r.ok) return failed(r.error);
    if (r.status === "new") {
      // No account yet: "Just use my phone number" (a phone account), their
      // email (most members without a phone on file have one), or the
      // sign-up form.
      takeDown();
      setTried(digits);
      setEntry("");
      return setStep({ name: "notFound", phone: formatPhone(digits) });
    }
    if (r.status === "pick") return pickOne(r, digits);
    if (r.askName) {
      takeDown();
      setEntry("");
      return setStep({ name: "askName", request: r.request, digits });
    }
    landed(r.request, r.checkedIn, noCardNote(r.unlimited));
  }

  // "Just use my phone number": the number they typed is their account, and
  // they're checked in with it.
  async function usePhone() {
    if (busy || !tried) return;
    const ticket = session.current;
    const phone = formatPhone(tried);
    setBusy(true);
    setError(null);
    startReward();
    const r = await createPhoneAccount(tried, notThem === tried).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r) return failed(OFFLINE);
    if (!r.ok) return failed(r.error);
    // Someone put this number on their account a moment ago, and it's shared now.
    if ("status" in r) return pickOne(r, tried);
    // Someone made an account with this number a moment ago: just checked in.
    landed(r.request, r.checkedIn, r.made ? { name: "phoneMade", phone } : null);
  }

  // "Add your name?": saved with the check-in.
  async function saveName() {
    if (busy || step.name !== "askName") return;
    if (!firstName.trim()) return setError("Type your first name.");
    const ticket = session.current;
    setBusy(true);
    setError(null);
    startReward();
    const r = await nameCheckin({ phone: step.digits, firstName, lastInitial: lastName }).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r) return failed(OFFLINE);
    if (!r.ok) return failed(r.error);
    if ("status" in r) return pickOne(r, step.digits);
    landed(r.request, r.checkedIn);
  }

  // Skipped (or walked away from): checked in without it.
  async function skipName() {
    if (busy || step.name !== "askName") return;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    startReward();
    const r = await checkInNow(step.request.ref).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r || !r.ok) return failed(r?.error ?? OFFLINE);
    if ("status" in r) return pickOne(r, step.digits);
    landed(r.request, r.checkedIn);
  }

  async function signUp() {
    if (busy) return;
    if (!firstName.trim()) return setError("Type your first name.");
    if (!lastName.trim()) return setError("Type your last name.");
    if (!cleanEmail(newEmail)) return setError("Check your email address.");
    const phone = phoneDigits(newPhone);
    if (phone && !isFullPhone(phone)) return setError("Check your phone number, or leave it blank.");
    const ticket = session.current;
    setBusy(true);
    setError(null);
    startReward();
    const r = await createKioskMember({ firstName, lastName, email: newEmail, phone: phone || null, notThem: !!phone && notThem === phone }).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return takeDown();
    if (!r) return failed(OFFLINE);
    if (!r.ok) return failed(r.error);
    // Their email (or number) is on an account after all: that one.
    if (r.status === "found") return found(r);
    if (r.status === "pick") return pickOne(r, phone);
    if (r.status === "known") return landed(r.request, r.checkedIn);
    landed(r.request, r.checkedIn, { name: "created", firstName: r.firstName, claimUrl: r.claimUrl, emailed: r.emailed });
  }

  const badAreaCode = !emailish && entry.length === 10 && !isFullPhone(entry);

  return (
    <section className={k.checkin} aria-label="Check in">
      {toasts.length > 0 && (
        <div className={k.toasts} aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.key}
              className={`${k.toast} ${t.tone === "warn" ? k.toastWarn : ""} ${t.tone === "badge" ? k.toastBadge : ""} ${t.claimUrl ? k.toastClaim : ""} ${t.line ? k.toastHasLine : ""}`}
              style={t.color ? { background: t.color } : undefined}
            >
              {t.emoji && (
                <span className={k.badgeEmoji} aria-hidden="true">
                  {t.emoji}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <div className={k.toastTitle}>{t.title}</div>
                <div className={k.toastDetail}>{t.detail}</div>
                {t.line && <div className={k.toastLine}>“{t.line}”</div>}
                {t.claimUrl && <div className={k.toastScan}>Scan to see your points online →</div>}
              </div>
              {t.claimUrl && <ClaimQr url={t.claimUrl} size={104} label="QR code: see your points online" />}
            </div>
          ))}
        </div>
      )}

      {onKeypad && (
        <>
          <div>
            <div className={k.eyebrow}>Check in · earn points</div>
            <h1 className={k.title}>Phone or email</h1>
          </div>
          <div className={k.display} aria-live="polite" aria-label="Phone or email">
            {entry ? (
              emailish ? (
                <span className={k.displayEmail}>{entry}</span>
              ) : (
                formatPhone(entry)
              )
            ) : (
              <span className={k.placeholder}>(___) ___-____</span>
            )}
            {entry && (
              <button type="button" className={k.displayClear} disabled={busy} onClick={() => press("clear")} aria-label="Clear">
                ×
              </button>
            )}
          </div>
          <div className={k.keys}>
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`${k.key} ${key === "back" ? k.keySmall : ""} ${key === "email" ? k.keyEmail : ""}`}
                disabled={busy}
                onClick={() => press(key)}
                aria-label={key === "back" ? "Delete last character" : key === "email" ? "Use your email" : key}
              >
                {key === "back" ? (
                  "⌫"
                ) : key === "email" ? (
                  <>
                    <span className={k.keyAt}>@</span>
                    <span className={k.keyAtLabel}>Email</span>
                  </>
                ) : (
                  key
                )}
              </button>
            ))}
          </div>
          {(error || badAreaCode) && <p className={k.error}>{error ?? "Start with your area code."}</p>}
          <button className={k.cta} disabled={busy || !entryReady} onClick={lookUp}>
            {busy ? "One moment…" : "Check in →"}
          </button>
          <p className={k.foot}>Email works too: tap @. New here? Start the same way.</p>
        </>
      )}

      {step.name === "phone" && step.letters && (
        <div className={k.board} role="group" aria-label="Check in with your email">
          <div className={k.boardHead}>
            <div style={{ minWidth: 0 }}>
              <div className={k.eyebrow}>Check in · earn points</div>
              <h1 className={k.title}>{step.notFound ? "Try your email?" : "Your email"}</h1>
              {error ? (
                <p className={k.boardError}>{error}</p>
              ) : step.notFound ? (
                <p className={k.sub}>We couldn&apos;t find {step.notFound}.</p>
              ) : null}
            </div>
            <div className={k.boardActions}>
              <button type="button" className={k.ghost} disabled={busy} onClick={() => startNew()}>
                I&apos;m new here
              </button>
              <button type="button" className={`${k.ghost} ${k.ghostIcon}`} disabled={busy} onClick={reset} aria-label="Start over">
                ✕
              </button>
            </div>
          </div>
          <div className={k.boardEntry} aria-live="polite" aria-label="Phone or email">
            <span className={k.boardText}>
              {entry ? (
                <span>
                  {entry}
                  <span className={k.caret} aria-hidden="true" />
                </span>
              ) : (
                <span className={k.placeholder}>you@email.com</span>
              )}
            </span>
          </div>
          <button className={`${k.cta} ${k.boardCta}`} disabled={busy || !entryReady} onClick={lookUp}>
            {busy ? "One moment…" : "Check in →"}
          </button>
          <LetterKeys disabled={busy} onKey={pressLetter} onDomain={domain} />
        </div>
      )}

      {step.name === "notFound" && (
        <>
          <div>
            <div className={k.eyebrow}>Check in · earn points</div>
            <h1 className={k.title}>Welcome! Are you new?</h1>
            <p className={k.sub} style={{ marginTop: 8, fontSize: 18 }}>
              We don&apos;t have {step.notThem ? "you on " : ""}
              <strong style={{ color: "var(--cream)" }}>{step.phone}</strong> yet.
            </p>
          </div>
          <button className={`${k.cta} ${k.choice}`} disabled={busy} onClick={usePhone}>
            <span>{busy ? "One moment…" : "Just use my phone number"}</span>
            {!busy && <span className={k.choiceSub}>No email, no password. Start earning points today.</span>}
          </button>
          {error && <p className={k.error}>{error}</p>}
          <div className={k.choiceRow}>
            <button className={k.ghost} disabled={busy} onClick={() => setStep({ name: "phone", letters: true, notFound: step.phone })}>
              Try my email
            </button>
            <button className={k.ghost} disabled={busy} onClick={() => startNew()}>
              Sign up with name &amp; email
            </button>
          </div>
          <button type="button" className={`${k.ghost} ${k.ghostShort}`} disabled={busy} onClick={reset}>
            Start over
          </button>
        </>
      )}

      {step.name === "pick" && (
        <>
          <div>
            <div className={k.eyebrow}>Check in · earn points</div>
            <h1 className={k.title}>Which one is you?</h1>
            <p className={k.sub} style={{ marginTop: 8, fontSize: 18 }}>
              A few accounts share <strong style={{ color: "var(--cream)" }}>{formatPhone(step.digits)}</strong>.
            </p>
          </div>
          <div className={k.pickList}>
            {step.choices.map((c) => (
              <button key={c.ref} className={`${k.cta} ${k.pick}`} disabled={busy} onClick={() => void choose(c)}>
                {keepTogether(c.name)}
              </button>
            ))}
          </div>
          {error && <p className={k.error}>{error}</p>}
          <button className={k.ghost} disabled={busy} onClick={noneOfThese}>
            None of these
          </button>
          <button type="button" className={`${k.ghost} ${k.ghostShort}`} disabled={busy} onClick={reset}>
            Start over
          </button>
        </>
      )}

      {step.name === "phoneMade" && (
        <div className={k.done}>
          <div className={k.check} aria-hidden="true">
            ✓
          </div>
          <h1 className={k.title}>That&apos;s it!</h1>
          <p className={k.big}>Your phone number is your account.</p>
          <div className={k.phoneBig}>{step.phone}</div>
          <p className={k.big}>Just type it each time you come in, and your points add up.</p>
          <p className={k.sub}>You&apos;re checked in for today.</p>
          <button className={k.cta} style={{ alignSelf: "stretch" }} onClick={reset}>
            Done
          </button>
        </div>
      )}

      {step.name === "askName" && (
        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <div>
            <div className={k.eyebrow}>Welcome back</div>
            <h1 className={k.title}>Add your name?</h1>
            <p className={k.sub} style={{ marginTop: 8, fontSize: 18 }}>
              So we can say hello. It&apos;s fine to skip.
            </p>
          </div>
          <div className={k.fieldRow}>
            <label className={k.field}>
              <span className={k.fieldLabel}>First name</span>
              <input
                className={`${k.input} ${k.inputCompact}`}
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={40}
                value={firstName}
                onChange={(e) => {
                  setError(null);
                  setFirstName(e.target.value);
                }}
              />
            </label>
            <label className={k.field} style={{ maxWidth: 150 }}>
              <span className={k.fieldLabel}>Last initial</span>
              <input
                className={`${k.input} ${k.inputCompact}`}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                maxLength={2}
                value={lastName}
                onChange={(e) => {
                  setError(null);
                  setLastName(e.target.value);
                }}
              />
            </label>
          </div>
          {error && <p className={k.error}>{error}</p>}
          <button type="submit" className={k.cta} disabled={busy || !firstName.trim()}>
            {busy ? "One moment…" : "Save & check in →"}
          </button>
          <button type="button" className={k.ghost} disabled={busy} onClick={skipName}>
            Skip · just check me in
          </button>
        </form>
      )}

      {step.name === "new" && (
        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            void signUp();
          }}
        >
          <div>
            <div className={k.eyebrow}>Welcome to the Royale</div>
            <h1 className={k.title}>Let&apos;s get you in</h1>
            <p className={k.sub} style={{ marginTop: 6 }}>
              {step.missed ? "We couldn't find that email. Fix it below, or join free." : "Free to join. Every visit earns points."}
            </p>
          </div>
          <div className={k.fieldRow}>
            <label className={k.field}>
              <span className={k.fieldLabel}>First name</span>
              <input
                className={`${k.input} ${k.inputCompact}`}
                autoFocus
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={40}
                value={firstName}
                onChange={(e) => {
                  setError(null);
                  setFirstName(e.target.value);
                }}
              />
            </label>
            <label className={k.field}>
              <span className={k.fieldLabel}>Last name</span>
              <input
                className={`${k.input} ${k.inputCompact}`}
                autoComplete="family-name"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={40}
                value={lastName}
                onChange={(e) => {
                  setError(null);
                  setLastName(e.target.value);
                }}
              />
            </label>
          </div>
          <label className={k.field}>
            <span className={k.fieldLabel}>Email</span>
            <input
              className={`${k.input} ${k.inputCompact}`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              maxLength={MAX_ENTRY}
              value={newEmail}
              onChange={(e) => {
                setError(null);
                setNewEmail(e.target.value);
              }}
            />
          </label>
          <label className={k.field}>
            <span className={k.fieldLabel}>Phone (optional)</span>
            <input
              className={`${k.input} ${k.inputCompact}`}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              enterKeyHint="done"
              maxLength={20}
              value={newPhone}
              onChange={(e) => {
                setError(null);
                setNewPhone(e.target.value);
              }}
            />
          </label>
          {error && <p className={k.error}>{error}</p>}
          <button type="submit" className={k.cta} disabled={busy || !firstName.trim() || !lastName.trim() || !cleanEmail(newEmail)}>
            {busy ? "One moment…" : "Create my account →"}
          </button>
          <button type="button" className={`${k.ghost} ${k.ghostShort}`} disabled={busy} onClick={reset}>
            Start over
          </button>
        </form>
      )}

      {step.name === "found" && (
        <div className={k.done}>
          <div className={k.eyebrow}>Found you</div>
          <h1 className={k.title}>Welcome back, {keepTogether(step.who)}!</h1>
          <div className={k.offer}>
            <p className={k.offerTitle}>Add this phone for one-tap check-in next time?</p>
            <div className={k.offerPhone}>{step.phone}</div>
            {error && <p className={k.error}>{error}</p>}
            <button className={k.cta} disabled={busy} onClick={() => void choosePhone(true)}>
              Add it ✓
            </button>
            <button className={k.ghost} disabled={busy} onClick={() => void choosePhone(false)}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step.name === "sent" && step.unlimited && (
        <div className={k.done}>
          <div className={k.eyebrow}>Insiders+</div>
          <h1 className={k.title}>Unlimited membership: no card on file</h1>
          <p className={k.sub} style={{ fontSize: 20 }}>
            Tap your card at the register to keep it going — ${RATE_PRICE.adult} a month.
          </p>
          <button className={k.ghost} style={{ alignSelf: "stretch" }} onClick={reset}>
            OK
          </button>
        </div>
      )}

      {step.name === "sent" && !step.unlimited && (
        <div className={k.done}>
          <div className={k.check} aria-hidden="true">
            ✓
          </div>
          <h1 className={k.title}>{step.who ? `Welcome back, ${keepTogether(step.who)}!` : "Thanks!"}</h1>
          <p className={k.sub} style={{ fontSize: 20 }}>
            The box office will check you in.
          </p>
        </div>
      )}

      {step.name === "created" && (
        <div className={k.done}>
          <div className={k.eyebrow}>You&apos;re in</div>
          <h1 className={k.title}>Welcome, {step.firstName}!</h1>
          <p className={k.sub} style={{ fontSize: 18 }}>
            Your first visit is checked in, and its points are on your account.
          </p>
          {step.claimUrl && isClaimUrl(step.claimUrl) ? (
            <ClaimQrSlot url={step.claimUrl} emailed={!!step.emailed} />
          ) : (
            step.emailed && <p className={k.sub}>We emailed you a link to finish your account.</p>
          )}
          <button className={k.cta} style={{ alignSelf: "stretch" }} onClick={reset}>
            Done · next person
          </button>
        </div>
      )}

      {reward && <CheckinReward key={reward.key} shown={reward} onDone={rewardDone} />}

      {celebration && (
        <PointsCelebration
          key={celebration.key}
          firstName={celebration.firstName}
          earned={celebration.earned}
          balance={celebration.balance}
          accent={celebration.accent}
          headline={celebration.headline}
          detail={celebration.detail}
          long={celebration.long}
          onDone={() => setCelebration(null)}
        />
      )}

      {entrance && (
        <FlairEffect
          key={entrance.key}
          entrance={entrance.entrance}
          color={entrance.color}
          sticker={entrance.sticker}
          mode="screen"
          seed={Math.floor(entrance.key) % 100_000}
          onDone={nextEntrance}
        />
      )}
    </section>
  );
}

// The "finish on your phone" QR code for an account just made here: a
// 30-minute claim link from createKioskMember (lib/member-claim.ts). With no
// link (say the member_claims migration isn't applied yet), the screen is
// the plain welcome. emailed: the same kind of link is in their inbox too.
function ClaimQrSlot({ url, emailed }: { url: string; emailed: boolean }) {
  if (!isClaimUrl(url)) return null;
  return (
    <div className={k.claim}>
      <ClaimQr url={url} size={150} label="QR code: finish your account on your phone" />
      <div className={k.claimCopy}>
        <div className={k.claimTitle}>Scan to finish on your phone</div>
        <p className={k.sub}>Add a login to see your points. No need to hold up the line.</p>
        {emailed && <p className={k.sub}>Or use the link we emailed you.</p>}
      </div>
    </div>
  );
}

// "Sarah M." never breaks between the name and the initial.
const keepTogether = (name: string) => name.replace(/ /g, " ");

