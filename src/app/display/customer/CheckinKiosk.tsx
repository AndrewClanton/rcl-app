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
} from "@/lib/checkin";
import { RATE_PRICE } from "@/lib/membership-rates";
import { finishShown, type FinishShown } from "./FinishCard";
import { createKioskMember, createPhoneAccount, nameCheckin, startCheckin, startEmailCheckin, type CheckinFound } from "./actions";
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

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

export type CheckinStep =
  // "Phone or email": always there between check-ins. The number keypad,
  // or with `letters` the full keyboard (over the whole screen while it's
  // up). notFound: the number they typed that we don't know, formatted
  // ("Try your email?").
  | { name: "phone"; letters?: boolean; notFound?: string }
  // A number we don't know (formatted): "Just use my phone number" first,
  // then "Try my email" or the sign-up form.
  | { name: "notFound"; phone: string }
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

// The number keypad. "email" switches to the full keyboard (LetterKeys).
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "email", "0", "back"];

// What's typed is a phone number while it's only digits, and an email
// once it has an @ or a letter in it.
const isEmailish = (s: string) => /[@a-z]/i.test(s);
const MAX_ENTRY = 100;

// The check-in half of the customer tablet: always "Phone or email", built
// for a line at the door, where nobody waits on the bartender.
// - A known number goes to the register as an opaque request and the panel
//   is straight back to the keypad. Staff confirm by photo when they can;
//   that pays the visit points, and a banner says so here.
// - A number we don't know doesn't make an account: "Try your email?" (most
//   members without a phone on file have an email), with "I'm new here".
// - A known email gets "Welcome back, Sarah M.!" (first name and last
//   initial only, Andrew 10/1). If their account has no phone and they
//   typed one first, they're offered to add it for next time; it's saved
//   when staff confirm them at the register, which shows it on the card.
// - Someone new gives their name and email (phone optional) and the
//   account is made right away (email marketing off), then a QR code to
//   finish on their own phone, and the same link by email. Staff still
//   confirm the visit on the register.
// - A known number or email that's a former unlimited member's with no
//   card on file here (lib/legacy-plus.ts) gets "Unlimited membership: no
//   card on file" and where to tap their card (Andrew, 10/1). The register
//   can then put a QR code up for them to add it on their phone.
// Until staff have confirmed, this screen shows nothing about anyone but
// that "Sarah M." for an email. Then just a first name and points, their
// profile line, and their entrance in their color (lib/flair.ts; or a
// party in their birthday week), and, for a member with no website login
// yet, a QR code in the banner to set one up. When a sale with a member on
// it completes, the register says so and the points burst plays here.
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
export default function CheckinKiosk({
  registerTopic,
  initialStep,
  onTickets,
  onRewind,
  onFinish,
  onPlusWelcome: onPlusWelcomeShown,
}: {
  registerTopic: string;
  initialStep?: CheckinStep;
  onTickets?: (shown: TicketsShown) => void;
  onRewind?: () => void;
  onFinish?: (shown: FinishShown | null) => void;
  onPlusWelcome?: (firstName: string) => boolean;
}) {
  const [step, setStep] = useState<CheckinStep>(initialStep ?? { name: "phone" });
  // "Phone or email", as typed.
  const [entry, setEntry] = useState("");
  // A number they tried that we don't know (ten digits): offered to add to
  // the account their email finds, or filled in on the new-account form.
  const [tried, setTried] = useState<string | null>(null);
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

  function send(event: string, payload: object) {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }

  function resetForm() {
    setEntry("");
    setTried(null);
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

  const onSeen = useEffectEvent((id: unknown) => {
    const item = typeof id === "string" ? outbox.current.get(id) : undefined;
    if (item) item.seen = true;
  });

  const onConfirmed = useEffectEvent((p: Partial<CheckinConfirmed> | null) => {
    if (!p || typeof p.id !== "string" || typeof p.firstName !== "string") return;
    // Only our own requests (another screen's check-ins aren't ours to announce).
    if (!outbox.current.delete(p.id)) return;
    confirmedHere.current.set(p.id, Date.now());
    for (const [id, at] of confirmedHere.current) if (Date.now() - at > 5 * 60_000) confirmedHere.current.delete(id);
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
    toast({
      title: guest ? (p.isNew ? "Welcome to the Royale!" : "✓ You're checked in") : p.isNew ? `Welcome to the Royale, ${name}!` : `✓ ${name}, you're checked in`,
      detail: guest ? `Phone ${name.replace(/^Guest /, "")} · ${detail}` : detail,
      tone: "ok",
      emoji: null,
      claimUrl: isClaimUrl(p.claimUrl) ? p.claimUrl : null,
      line: lineFromChannel(p.line),
      color: flair.color?.hex ?? null,
    });
    if (show !== "classic") playEntrance({ entrance: show, color: flairHex(flair), sticker: flair.sticker });
    badges.forEach((b, i) => {
      const c = badgeCheer(b, guest ? "friend" : name);
      setTimeout(() => toast({ title: c.title, detail: c.detail, tone: "badge", emoji: c.emoji, claimUrl: null }, b.reward ? BADGE_REWARD_MS : BADGE_MS), BADGE_STAGGER_MS * (i + 1));
    });
  });

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

  const onDeclined = useEffectEvent((id: unknown) => {
    if (typeof id !== "string" || !outbox.current.delete(id)) return;
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
        .on("broadcast", { event: "checkin-declined" }, (msg) => onDeclined(msg.payload?.id))
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

  const emailish = isEmailish(entry);
  const entryReady = emailish ? !!cleanEmail(entry) : isFullPhone(entry);
  const onKeypad = step.name === "phone" && !step.letters;

  function showLetters(letters: boolean) {
    setError(null);
    if (step.name === "phone") setStep({ ...step, letters });
  }

  // One entry for both keyboards: the keypad's digits stop at a phone
  // number's ten unless it's already an email.
  function type(text: string) {
    setError(null);
    setEntry((e) => {
      if (text === "@" && e.includes("@")) return e;
      const next = (e + text).toLowerCase();
      if (onKeypad && !isEmailish(next) && next.length > 10) return e;
      return next.slice(0, MAX_ENTRY);
    });
  }

  function press(key: string) {
    setError(null);
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

  // Found by email: straight to the register, or first "Add this phone?".
  function found(r: CheckinFound) {
    if (r.withPhone && r.phone) {
      setStep({ name: "found", who: r.name, phone: r.phone, request: r.request, withPhone: r.withPhone, unlimited: r.unlimited });
      return;
    }
    queue(r.request);
    resetForm();
    setStep(r.unlimited ? { name: "sent", unlimited: true } : { name: "sent", who: r.name });
  }

  function choosePhone(add: boolean) {
    if (step.name !== "found") return;
    queue(add ? step.withPhone : step.request);
    resetForm();
    setStep(step.unlimited ? { name: "sent", unlimited: true } : { name: "sent", who: step.who });
  }

  async function lookUp() {
    if (busy || !entryReady) return;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    if (emailish) {
      const r = await startEmailCheckin({ email: entry, phone: tried }).catch(() => null);
      setBusy(false);
      if (ticket !== session.current) return;
      if (!r) return setError(OFFLINE);
      if (!r.ok) return setError(r.error);
      // Not one we know: make them an account (a typo can be fixed there,
      // and an email that's on an account is still found).
      if (r.status === "new") return startNew(true);
      return found(r);
    }
    const digits = entry;
    const r = await startCheckin(digits).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    if (r.status === "new") {
      // No account yet: "Just use my phone number" (a phone account), their
      // email (most members without a phone on file have one), or the
      // sign-up form.
      setTried(digits);
      setEntry("");
      return setStep({ name: "notFound", phone: formatPhone(digits) });
    }
    if (r.askName) {
      setEntry("");
      return setStep({ name: "askName", request: r.request, digits });
    }
    queue(r.request);
    resetForm();
    setStep(r.unlimited ? { name: "sent", unlimited: true } : { name: "sent" });
  }

  // "Just use my phone number": the number they typed is their account.
  async function usePhone() {
    if (busy || !tried) return;
    const ticket = session.current;
    const phone = formatPhone(tried);
    setBusy(true);
    setError(null);
    const r = await createPhoneAccount(tried).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    queue(r.request);
    resetForm();
    // Someone made an account with this number a moment ago: checked in.
    setStep(r.made ? { name: "phoneMade", phone } : { name: "sent" });
  }

  // "Add your name?": saved when staff confirm the check-in.
  async function saveName() {
    if (busy || step.name !== "askName") return;
    if (!firstName.trim()) return setError("Type your first name.");
    const ticket = session.current;
    setBusy(true);
    setError(null);
    const r = await nameCheckin({ phone: step.digits, firstName, lastInitial: lastName }).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    queue(r.request);
    resetForm();
    setStep({ name: "sent", who: r.firstName });
  }

  function skipName() {
    if (step.name !== "askName") return;
    queue(step.request);
    resetForm();
    setStep({ name: "sent" });
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
    const r = await createKioskMember({ firstName, lastName, email: newEmail, phone: phone || null }).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    // Their email (or number) is on an account after all: that one.
    if (r.status === "found") return found(r);
    queue(r.request);
    resetForm();
    if (r.status === "known") return setStep({ name: "sent" });
    setStep({ name: "created", firstName: r.firstName, claimUrl: r.claimUrl, emailed: r.emailed });
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
              We don&apos;t have <strong style={{ color: "var(--cream)" }}>{step.phone}</strong> yet.
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

      {step.name === "phoneMade" && (
        <div className={k.done}>
          <div className={k.check} aria-hidden="true">
            ✓
          </div>
          <h1 className={k.title}>That&apos;s it!</h1>
          <p className={k.big}>Your phone number is your account.</p>
          <div className={k.phoneBig}>{step.phone}</div>
          <p className={k.big}>Just type it each time you come in, and your points add up.</p>
          <p className={k.sub}>The box office will confirm you in a moment.</p>
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
            <button className={k.cta} onClick={() => choosePhone(true)}>
              Add it ✓
            </button>
            <button className={k.ghost} onClick={() => choosePhone(false)}>
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
            The box office will confirm you in a moment.
          </p>
        </div>
      )}

      {step.name === "created" && (
        <div className={k.done}>
          <div className={k.eyebrow}>You&apos;re in</div>
          <h1 className={k.title}>Welcome, {step.firstName}!</h1>
          <p className={k.sub} style={{ fontSize: 18 }}>
            The box office will confirm your first visit and your points will land.
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

