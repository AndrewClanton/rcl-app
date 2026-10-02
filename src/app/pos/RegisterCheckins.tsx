"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MemberAvatar from "@/components/MemberAvatar";
import InfoTip from "@/components/help/InfoTip";
import { checkinTopic, firstNameOf, last10, type CheckinConfirmed, type CheckinKind, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import type { ReceiptData } from "@/lib/print/receipt";
import { POINTS_PER_REWARD } from "@/lib/loyalty";
import { REWARD_LABEL, badgeFor, badgeList } from "@/lib/visits";
import { entranceFor, flairColor, parseFlair } from "@/lib/flair";
import { confirmVisit, createCheckinMember, getDuplicateHint, getHereToday, resolveCheckin, undoCheckin, type CheckinCard, type HereToday } from "./checkin-actions";
import { getPosMember, type PosMember } from "./member-actions";
import { getMemberTicketsToday } from "./scan-actions";
import { printDoorTickets } from "./door-print";
import { usePrintTarget } from "./printing";
import { tabletTickets, type CheckinTickets, type DoorTicket } from "@/lib/door-tickets";
import { NOT_ACTIVE_RED, NotActiveStamp, type TabletSend } from "./LegacyPlusCard";
import { memberSignal, memberStanding } from "./member-signal";
import { shortName } from "@/lib/card-match";
import type { VisitWaiting } from "./PosMemberPanel";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

export interface Pending {
  id: string;
  ref: string;
  kind: CheckinKind;
  at: number;
  card: CheckinCard | null; // null while it's being looked up
  error: string | null;
  working: boolean;
}

type Tonight = { member: PosMember; tickets: DoorTicket[] };
// olderId/unlimited: the older account paid for unlimited on the old site
// and has nothing paying here (lib/legacy-plus.ts), so staff can open it to
// set that up (the tablet couldn't find it: usually no phone on file).
type DupHint = { name: string; href: string | null; olderId: string | null; unlimited: boolean };

// A request's sealed reference stops working after 15 minutes (see
// lib/checkin-server.ts), so its card goes then too.
const LIFETIME_MS = 15 * 60_000;
const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

// When something happened (a request arrived). Only ever called from event
// handlers, never while rendering.
const clock = () => Date.now();

function ago(ms: number) {
  return ms < 60_000 ? "just now" : `${Math.floor(ms / 60_000)} min ago`;
}

function pts(n: number) {
  const r = Math.round(n);
  return `${r.toLocaleString("en-US")} pt${r === 1 ? "" : "s"}`;
}

function phoneEnding(m: PosMember) {
  const d = last10(m.phone);
  return d ? `phone ••${d.slice(-4)}` : "no phone on file";
}

// A check-in that just came in from the customer screen, popped up over the
// top of the order (CheckinArrivals): their face and name, big, so staff
// put the two together. Checked in already at the screen (done): what
// staff need to give great service (where they stand and the one most
// useful thing to know or do, serviceNote) and "Undo / Not them" for a
// mistake. A shared family number still waiting: a tap to pick who it is
// on the Customers tab.
export interface Arrival {
  id: string; // the check-in's
  name: string; // "Sarah M."
  photo: string | null;
  plus: boolean; // Insiders+ that's paid for: the gold ring
  color: string | null; // their favorite color (lib/flair.ts), a stripe down the side
  note: string;
  tone?: "red" | "gold" | null; // the note's: red for no payment on file
  sub?: string; // "+5 pts · 140 pts · 🔥 3 weeks"
  done?: boolean;
  working?: boolean; // being undone
}

// Up this long (a little longer for a check-in that's done: there's more
// to read), at most this many at once (the newest), and gone as soon as
// it's answered or undone.
const ARRIVAL_MS = 8_000;
const DONE_ARRIVAL_MS = 12_000;
const ARRIVALS_MAX = 2;

// A check-in done at the screen (its visit recorded and paid there), kept
// for Undo while its sealed reference lasts. auto: it put them on the order.
export interface RecentCheckin {
  id: string;
  ref: string;
  at: number;
  member: PosMember;
  card: Extract<CheckinCard, { kind: "known" }>;
  auto: boolean;
  working: boolean;
}

// The one most useful thing for staff to know about who just walked in,
// most urgent first: money (red), a first visit, their birthday week, a
// name to ask for, a free coffee waiting, a new badge; else where they
// stand.
export function serviceNote(m: PosMember, card: Extract<CheckinCard, { kind: "known" }>): { text: string; tone: "red" | "gold" | null } {
  if (m.legacyUnlimited) return { text: "No payment on file for unlimited", tone: "red" };
  const signal = memberStanding(m);
  if (signal === "nocard") return { text: "Insiders+ · no card on file", tone: "red" };
  if (card.today?.visits === 1 || (card.fresh && !card.today)) return { text: "First visit · welcome them!", tone: "gold" };
  if (m.partyWeek) return { text: "🎂 Birthday week!", tone: "gold" };
  if (m.named === false) return { text: "Ask their name?", tone: null };
  if (signal === "plus" && card.coffee === "ready") return { text: "Insiders+ · free coffee ready ☕", tone: "gold" };
  const badges = (card.today?.badges ?? []).flatMap((k) => badgeFor(k)?.label ?? []);
  if (badges.length) return { text: `New badge: ${badges.join(", ")}`, tone: "gold" };
  return { text: signal === "plus" ? "Insiders+ · Active" : `${m.tier}`, tone: null };
}

// "+5 pts · 140 pts · 🔥 3 weeks", or "Already checked in today · 140 pts".
function visitLine(m: PosMember, card: Extract<CheckinCard, { kind: "known" }>): string {
  const t = card.today;
  const streak = t?.streak && t.streak > 1 ? ` · 🔥 ${t.streak} weeks` : "";
  if (card.paid === false) return `Already checked in today · ${pts(m.points)}`;
  return `${t?.points ? `+${pts(t.points)} · ` : ""}${pts(m.points)}${streak}`;
}

// Checked in at the screen a moment ago. One from longer ago (a register
// that opened since, or was offline) is shown, but not put on the order:
// they've likely gone, and the order on screen is someone else's.
const AUTO_ATTACH_S = 120;
const fresh = (card: Extract<CheckinCard, { kind: "known" }>) => (card.age ?? 0) < AUTO_ATTACH_S;

// The tablet's "Just use my phone number" just made it (lib/member-name.ts).
function freshPhoneAccount(card: Extract<CheckinCard, { kind: "known" }>) {
  return card.fresh === true && card.matches.length === 1 && card.matches[0].named === false && card.matches[0].phoneOnly === true;
}

function arrivalFor(id: string, card: CheckinCard): Arrival {
  if (card.kind === "new") return { id, name: card.firstName, photo: null, plus: false, color: null, note: "New regular · just signed up" };
  if (card.matches.length === 1) {
    const m = card.matches[0];
    const face = { id, name: shortName(m.name), photo: m.avatar_url, plus: memberSignal(m) === "plus", color: flairColor(m.flair?.color)?.hex ?? null };
    if (card.done) {
      const note = serviceNote(m, card);
      return { ...face, note: note.text, tone: note.tone, sub: visitLine(m, card), done: true };
    }
    return {
      ...face,
      note: freshPhoneAccount(card) ? "New phone account · just joined" : card.fresh ? "New regular · just signed up" : card.addName ? `Just checked in · adding name ${card.addName}` : "Just checked in",
    };
  }
  const names = card.matches.map((m) => shortName(m.name));
  return {
    id,
    name: names.length === 2 ? names.join(" or ") : `${names.length} accounts`,
    photo: null,
    plus: false,
    color: null,
    note: `Phone ••${card.phoneLast4}: which one?`,
  };
}

export interface Checkins {
  pending: Pending[];
  // The latest check-ins still waiting, popped up over the order.
  arrivals: Arrival[];
  dismissArrival: (id: string) => void;
  now: number;
  here: HereToday[];
  notice: string | null;
  tonight: Tonight | null;
  dupHint: DupHint | null;
  // A former unlimited member just checked in with no payment on file
  // (lib/legacy-plus.ts): the card to set it up, top of the Customers tab.
  unlimited: PosMember | null;
  printing: boolean;
  // Check-ins done at the screen lately, newest first, for Undo.
  recent: RecentCheckin[];
  retry: (p: Pending) => void;
  confirm: (p: Pending, m: PosMember, addToOrder: boolean) => void;
  // "Undo / Not them" on a done check-in (its pop-up, the Member box, or
  // the Customers tab): the visit and its points taken back.
  undo: (id: string) => void;
  // The member on the order's check-in from the screen, for the order's
  // Member box: done (with Undo), or still waiting (confirm or Not them).
  visitFor: (memberId: string | null) => VisitWaiting | null;
  // The guest tapped "That's not me" under their card on the customer
  // screen (PosApp has taken them off the order): the check-in that put
  // them there is undone too.
  notMe: (memberId: string) => void;
  create: (p: Pending, existingId: string | null, addToOrder: boolean) => void;
  decline: (p: Pending) => void;
  printTonight: () => void;
  dismissNotice: () => void;
  dismissTonight: () => void;
  dismissDupHint: () => void;
  // Opens the older account from the duplicate hint (and puts it on the order).
  openOlder: () => void;
  dismissUnlimited: () => void;
  // To the customer screen, on the check-in channel (LegacyPlusCard).
  toTablet: TabletSend;
}

// The register's side of "Check in for points" on the customer screen.
// Always running while the register is open (PosApp calls it), whatever is
// on screen: it listens for check-ins and tells the customer screen what
// happened. What staff see lives on the register's Customers tab
// (CustomersTab.tsx), so nothing floats over the menu buttons, and each new
// check-in pops up over the top of the order for a few seconds
// (CheckinArrivals).
//
// Typing a number or email at the screen is the check-in (Andrew, 10/2):
// its visit is recorded and paid there (display/customer/actions.ts), so
// there's nothing for staff to confirm. Here it goes straight onto the
// order, the latest one in taking over from whoever was on it (autoAttach,
// PosApp: never mid-payment), and the pop-up shows who it is and the one
// thing to know (serviceNote). "Undo / Not them" (the pop-up, the order's
// Member box, or Just checked in on the Customers tab) takes the visit and
// its points back and takes them off the order (autoUndo: whoever they
// took over from comes back).
//
// Only a phone number shared by a few accounts still waits as a card for
// staff to pick the face (Waiting to confirm); its Check in pays the visit
// (lib/visits.ts), and "+ add to order" also puts them on the order.
// Everyone checked in today is listed under "Checked in today", faces
// first, so staff learn names and can put someone on an order with one
// tap. When a sale with a member on it completes, this tells the customer
// screen to play the points burst.
export function useRegisterCheckins({
  registerTopic,
  member,
  onAttach,
  autoAttach,
  autoUndo,
  hasOrder,
  lastSale,
}: {
  registerTopic: string;
  member: PosMember | null;
  onAttach: (m: PosMember) => void;
  // Puts them on the order: true if it did.
  autoAttach?: (m: PosMember) => boolean;
  // Takes someone autoAttach put on the order off it again.
  autoUndo?: (memberId: string) => void;
  hasOrder: boolean;
  lastSale: ReceiptData | null;
}): Checkins {
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [here, setHere] = useState<HereToday[]>([]);
  // Tickets bought online for today by whoever just checked in: one tap
  // prints them, instead of scanning.
  const [tonight, setTonight] = useState<Tonight | null>(null);
  // Someone the tablet just made an account for who's probably an older
  // member it couldn't find by phone: a quiet line with a Back office link.
  // Nothing is merged from the register.
  const [dupHint, setDupHint] = useState<DupHint | null>(null);
  const [unlimited, setUnlimited] = useState<PosMember | null>(null);
  const [printing, setPrinting] = useState(false);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  // Each check-in pops up once, even if its lookup is tried again.
  const arrived = useRef(new Set<string>());
  const printTarget = usePrintTarget();
  const channelRef = useRef<Channel | null>(null);
  // Requests answered here, so a screen that missed the answer can get it
  // again, and every request already on screen (screens resend until seen).
  const answered = useRef(new Map<string, { event: string; payload: object }>());
  const shown = useRef(new Set<string>());
  // Check-ins still waiting that put their member on the order by
  // themselves: check-in id -> member id.
  const [autoOn, setAutoOn] = useState<Record<string, string>>({});
  // Check-ins done at the screen, newest first, for Undo.
  const [recent, setRecent] = useState<RecentCheckin[]>([]);
  // The latest autoAttach and member on the order (a lookup or a check-in
  // finishes after the render it began in).
  const autoRef = useRef(autoAttach);
  const memberNow = useRef(member);
  useEffect(() => {
    autoRef.current = autoAttach;
    memberNow.current = member;
  });

  function send(event: string, payload: object) {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }

  function patch(id: string, changes: Partial<Pending>) {
    setPending((ps) => ps.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  }

  function remember(id: string, event: string, payload: object) {
    answered.current.set(id, { event, payload });
    if (answered.current.size > 50) answered.current.delete(answered.current.keys().next().value as string);
  }

  function answer(id: string, event: string, payload: object) {
    remember(id, event, payload);
    send(event, payload);
    setPending((ps) => ps.filter((p) => p.id !== id));
    setAutoOn((a) => (id in a ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== id)) : a));
  }

  // A request from the screen: who it is. Done at the screen already (its
  // visit recorded and paid there, as almost every one is): straight to
  // `recent`, on the order, and a pop-up for staff. Otherwise (a shared
  // family number) it waits in `pending` for staff to pick the face.
  async function load(id: string, ref: string, kind: CheckinKind) {
    patch(id, { error: null, working: true });
    const r = await resolveCheckin(ref).catch(() => null);
    const waiting = (changes: Partial<Pending>) =>
      setPending((ps) =>
        ps.some((p) => p.id === id) ? ps.map((p) => (p.id === id ? { ...p, ...changes } : p)) : [...ps, { id, ref, kind, at: clock(), card: null, error: null, working: false, ...changes }],
      );
    if (!r) return waiting({ working: false, error: OFFLINE });
    if (!r.ok) {
      // Too old to use: the screen has long since moved on.
      if (r.expired) return answer(id, "checkin-declined", { id });
      return waiting({ working: false, error: r.error });
    }
    if (r.card.kind === "known" && r.card.done && r.card.matches.length === 1) return checkedIn(id, ref, r.card);
    waiting({ working: false, card: r.card });
    send("checkin-seen", { id });
    // One account: on the order now (unless it's mid-payment).
    const one = r.card.kind === "known" && r.card.matches.length === 1 ? r.card.matches[0] : null;
    const auto = !!one && r.card.kind === "known" && fresh(r.card) && !!autoRef.current?.(one);
    if (one && auto) setAutoOn((a) => ({ ...a, [id]: one.id }));
    const a = arrivalFor(id, r.card);
    arrive(auto ? { ...a, note: "Now on this order" } : a);
  }

  // Checked in at the screen: seen (so it stops resending), on the order
  // (the latest one in takes over, unless it's mid-payment), a pop-up with
  // what staff need to know, and the same follow-ups a confirmation had.
  function checkedIn(id: string, ref: string, card: Extract<CheckinCard, { kind: "known" }>) {
    const m = card.matches[0];
    setPending((ps) => ps.filter((p) => p.id !== id));
    remember(id, "checkin-seen", { id });
    send("checkin-seen", { id });
    const auto = fresh(card) && !!autoRef.current?.(m);
    setRecent((rs) => [{ id, ref, at: clock(), member: m, card, auto, working: false }, ...rs.filter((x) => x.id !== id)].slice(0, 12));
    arrive(arrivalFor(id, card));
    followUp(id, m);
    const bits = [card.fresh ? `New regular ${m.name} checked in on the screen.` : `${m.name} checked in on the screen.`, visitLine(m, card) + "."];
    if (auto) bits.push("They're on the order.");
    setNotice(bits.join(" "));
  }

  function arrive(a: Arrival) {
    if (arrived.current.has(a.id)) return;
    arrived.current.add(a.id);
    if (arrived.current.size > 50) arrived.current.delete(arrived.current.values().next().value as string);
    setArrivals((as) => [...as, a].slice(-ARRIVALS_MAX));
    setTimeout(() => dismissArrival(a.id), a.done ? DONE_ARRIVAL_MS : ARRIVAL_MS);
  }

  // After a check-in: their tickets for today, if they bought any online (a
  // Print row on the Customers tab, and the tickets on the customer screen),
  // a possible second account for an older member, and the card to set up
  // an unlimited membership with no payment on file. Each its own message,
  // so nothing waits on another.
  function followUp(id: string, m: PosMember) {
    void getMemberTicketsToday(m.id)
      .then((t) => {
        if (!t.ok || t.tickets.length === 0) return;
        setTonight({ member: m, tickets: t.tickets });
        const shown: CheckinTickets = { id, firstName: firstNameOf(m.name), tickets: tabletTickets(t.tickets) };
        send("checkin-tickets", shown);
      })
      .catch(() => {});
    // Possibly a second account for an older member (made at the tablet,
    // same name, the old one has no usable phone).
    setDupHint(null);
    void getDuplicateHint(m.id)
      .then((h) => {
        if (h) setDupHint({ name: m.name, href: h.href, olderId: h.olderId, unlimited: h.unlimited });
      })
      .catch(() => {});
    // No payment on file for their unlimited membership: the card to set it
    // up goes to the top of the Customers tab.
    setUnlimited(m.legacyUnlimited ? m : null);
    void refreshHere();
  }

  // "Undo / Not them": the check-in's visit and its points taken back
  // (undoCheckin), and off the order if it put them there (whoever they
  // took over from comes back). detach false: they're off it already (they
  // said "That's not me" on the screen).
  async function undo(id: string, detach = true) {
    const rec = recent.find((r) => r.id === id);
    if (!rec || rec.working) return;
    setRecent((rs) => rs.map((r) => (r.id === id ? { ...r, working: true } : r)));
    const r = await undoCheckin(rec.member.id, rec.ref).catch(() => null);
    if (!r?.ok) {
      setRecent((rs) => rs.map((x) => (x.id === id ? { ...x, working: false } : x)));
      return setNotice(`${rec.member.name}: ${r?.error ?? OFFLINE}`);
    }
    setRecent((rs) => rs.filter((x) => x.id !== id));
    dismissArrival(id);
    if (detach) autoUndo?.(rec.member.id);
    setNotice(`${rec.member.name}: ${r.note}`);
    void refreshHere();
  }

  function dismissArrival(id: string) {
    setArrivals((as) => as.filter((a) => a.id !== id));
  }

  // Staff said "that's them": today's visit (its points, maybe badges and
  // a reward), and with addToOrder, onto the order too.
  async function confirm(p: Pending, cardMember: PosMember, isNew: boolean, note: string | null, addToOrder: boolean) {
    patch(p.id, { working: true, error: null });
    // The request goes along, so a phone or name they asked to add at the
    // tablet is saved now (confirmVisit); with a name, they come back with it.
    const r = await confirmVisit(cardMember.id, p.ref).catch(() => null);
    const m = (r?.ok && r.member) || cardMember;
    const visit = r?.ok ? r.visit : null;
    const already = memberNow.current?.id === m.id;
    // On the order already: refreshed there too (their new points).
    if (addToOrder || already) onAttach(m);
    const confirmed: CheckinConfirmed = {
      id: p.id,
      firstName: firstNameOf(m.name),
      points: Math.round(visit ? visit.balance : m.points),
      isNew,
      ...(visit
        ? { visit: { earned: visit.earned, visitPoints: visit.visitPoints, weekStreak: visit.weekStreak, alreadyToday: visit.alreadyToday, badges: visit.badges } }
        : {}),
      // No website login yet: the tablet shows a QR code to set one up.
      ...(r?.ok && r.claimUrl ? { claimUrl: r.claimUrl } : {}),
      // Their entrance and profile line (keys and their own words only; the
      // tablet checks both). A hidden line is already null.
      ...(m.flair ? { flair: { color: m.flair.color, entrance: entranceFor(parseFlair(m.flair), !!m.partyWeek), sticker: m.flair.sticker } } : {}),
      ...(m.tagline ? { line: m.tagline } : {}),
    };
    answer(p.id, "checkin-confirmed", confirmed);
    followUp(p.id, m);
    const bits = [
      isNew && m.phoneOnly && m.named === false
        ? `New phone account ${m.name} is set up and checked in. Add their name from the member box anytime.`
        : isNew
          ? `New regular ${m.name} is set up and checked in.`
          : `${m.name} checked in.`,
    ];
    if (visit?.alreadyToday) bits.push("Already checked in today, so no new points.");
    else if (visit) bits.push(`+${visit.visitPoints} pts${visit.weekStreak > 1 ? `, ${visit.weekStreak}-week streak` : ""}.`);
    else bits.push("Their visit points didn't save; check them in again later.");
    if (visit?.badges.length) bits.push(`New badge${visit.badges.length === 1 ? "" : "s"}: ${badgeList(visit.badges)}.`);
    for (const r of visit?.rewards ?? []) bits.push(`They earned: ${REWARD_LABEL[r]}! Redeem it from their member panel.`);
    if (addToOrder) bits.push(already ? "Already on this order." : hasOrder ? "On this order." : "They'll be on the next order.");
    if (r?.ok && r.phoneNote) bits.push(r.phoneNote);
    if (r?.ok && r.nameNote) bits.push(r.nameNote);
    if (note) bits.push(note);
    setNotice(bits.join(" "));
  }

  async function create(p: Pending, existingId: string | null, addToOrder: boolean) {
    patch(p.id, { working: true, error: null });
    const r = await createCheckinMember(p.ref, existingId).catch(() => null);
    if (!r) return patch(p.id, { working: false, error: OFFLINE });
    if (!r.ok) return patch(p.id, { working: false, error: r.error });
    await confirm(p, r.member, r.isNew, r.note, addToOrder);
  }

  async function printTonight() {
    if (!tonight || printing) return;
    setPrinting(true);
    const messages: string[] = [];
    for (const t of tonight.tickets.filter((x) => x.printable)) {
      const r = await printDoorTickets(printTarget, t.bookingId).catch(() => null);
      messages.push(!r ? OFFLINE : r.ok ? r.message : r.error);
    }
    const fresh = await getMemberTicketsToday(tonight.member.id).catch(() => null);
    setTonight(fresh?.ok && fresh.tickets.length ? { member: tonight.member, tickets: fresh.tickets } : null);
    setPrinting(false);
    if (messages.length) setNotice(messages.join(" "));
  }

  async function refreshHere() {
    const list = await getHereToday().catch(() => null);
    if (list) setHere(list);
  }

  // Not them: a check-in that put them on the order takes them off again.
  function decline(p: Pending) {
    const put = autoOn[p.id];
    answer(p.id, "checkin-declined", { id: p.id });
    if (put) autoUndo?.(put);
  }

  // The one account's check-in, for "✓ Check in" on its pop-up or in the
  // Member box: on the order already, they're refreshed there (their new
  // points, in confirm); otherwise the order is left as it is.
  function confirmOne(p: Pending) {
    if (p.card?.kind !== "known" || p.card.matches.length !== 1) return;
    void confirm(p, p.card.matches[0], p.card.fresh === true, null, false);
  }

  function visitFor(memberId: string | null): VisitWaiting | null {
    if (!memberId) return null;
    const rec = recent.find((r) => r.member.id === memberId);
    if (rec) return { done: true, auto: rec.auto, working: rec.working, line: visitLine(rec.member, rec.card), undo: () => void undo(rec.id) };
    const p = pending.find((x) => x.card?.kind === "known" && x.card.matches.length === 1 && x.card.matches[0].id === memberId);
    if (!p) return null;
    return { done: false, auto: autoOn[p.id] === memberId, working: p.working, confirm: () => confirmOne(p), undo: () => decline(p) };
  }

  // "That's not me" on the customer screen: the check-in that put them on
  // the order is undone (its visit and points), or one still waiting is
  // answered without the "see the box office" banner.
  function notMe(memberId: string) {
    for (const r of recent) if (r.member.id === memberId && r.auto) void undo(r.id, false);
    for (const [id, put] of Object.entries(autoOn)) if (put === memberId) answer(id, "checkin-declined", { id, quiet: true });
  }

  async function openOlder() {
    const id = dupHint?.olderId;
    if (!id) return;
    const m = await getPosMember(id).catch(() => null);
    if (!m) return setNotice("Couldn't open that account. Look them up by name instead.");
    onAttach(m);
    setDupHint(null);
    setNotice(`${m.name} (the older account) is on the order.`);
  }

  const onRequest = useEffectEvent((raw: Partial<CheckinRequest> | null) => {
    if (!raw || typeof raw.id !== "string" || typeof raw.ref !== "string" || (raw.kind !== "known" && raw.kind !== "new")) return;
    const { id, ref, kind } = raw;
    const done = answered.current.get(id);
    if (done) return send(done.event, done.payload);
    if (shown.current.has(id)) {
      if (pending.some((p) => p.id === id && p.card)) send("checkin-seen", { id });
      return;
    }
    shown.current.add(id);
    const at = clock();
    setNow(at);
    // Done at the screen: nothing to wait on (it shows once it's looked up).
    if (raw.done !== true) setPending((ps) => [...ps, { id, ref, kind, at, card: null, error: null, working: true }]);
    void load(id, ref, kind);
  });

  // The customer backed out on the screen.
  const onCancel = useEffectEvent((id: unknown) => {
    if (typeof id === "string") setPending((ps) => ps.filter((p) => p.id !== id));
  });

  // Another register answered it first.
  const onAnsweredElsewhere = useEffectEvent((payload: { id?: unknown } | null, event: string) => {
    if (!payload || typeof payload.id !== "string") return;
    remember(payload.id, event, payload);
    setPending((ps) => ps.filter((p) => p.id !== payload.id));
    if (event === "checkin-confirmed") void refreshHere();
  });

  // Checked in today: on load, then every couple of minutes.
  const loadHere = useEffectEvent(() => void refreshHere());
  useEffect(() => {
    const first = setTimeout(() => loadHere(), 0);
    const timer = setInterval(() => loadHere(), 120_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(checkinTopic(registerTopic));
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "checkin-request" }, (msg) => onRequest(msg.payload))
      .on("broadcast", { event: "checkin-cancel" }, (msg) => onCancel(msg.payload?.id))
      .on("broadcast", { event: "checkin-confirmed" }, (msg) => onAnsweredElsewhere(msg.payload, "checkin-confirmed"))
      .on("broadcast", { event: "checkin-declined" }, (msg) => onAnsweredElsewhere(msg.payload, "checkin-declined"))
      .subscribe((status) => {
        // Joined, or back after a dropped connection: a screen may have sent
        // its request while this register wasn't listening.
        if (status === "SUBSCRIBED") channel.send({ type: "broadcast", event: "checkin-sync", payload: {} });
      });
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [registerTopic]);

  // Keeps the "n min ago" labels current, and lets old cards go (and done
  // check-ins' Undo, with their sealed reference).
  useEffect(() => {
    if (!pending.length && !recent.length) return;
    const timer = setInterval(() => {
      const t = clock();
      setNow(t);
      setPending((ps) => ps.filter((p) => t - p.at < LIFETIME_MS));
      setRecent((rs) => (rs.some((r) => t - r.at >= LIFETIME_MS) ? rs.filter((r) => t - r.at < LIFETIME_MS) : rs));
    }, 30_000);
    return () => clearInterval(timer);
  }, [pending.length, recent.length]);

  // Nothing covers the menu any more, so the result can stay up long enough
  // to read (or until it's closed).
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 15_000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Points on the customer screen. PosApp clears the member in the same
  // update that records the sale, so remember who was on the order; the
  // receipt names them if they were still on it when it was paid. Points are
  // what completeOrder credits: 1 per $1 after the member, monthly and
  // reward discounts (pointsEarned). The balance is read back fresh, so the
  // 100 a reward takes is counted; if that read fails, it's worked out here.
  const lastMember = useRef<PosMember | null>(null);
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (member) lastMember.current = member;
  }, [member]);

  const announce = useEffectEvent(async (sale: ReceiptData) => {
    const m = lastMember.current;
    // A receipt from the register carries the figure; otherwise its
    // discounts are the member, monthly and reward ones.
    const exact = sale.points?.earned ?? Math.max(0, sale.subtotal - sale.discounts.reduce((s, d) => s + d.amount, 0));
    const earned = Math.round(exact);
    if (!m || sale.member !== m.name || earned < 1) return;
    const fresh = await getPosMember(m.id).catch(() => null);
    const payload: PointsEarned = {
      orderNumber: sale.orderNumber,
      firstName: firstNameOf(m.name),
      earned,
      balance: Math.round(fresh ? fresh.points : m.points + exact - (sale.points?.rewardUsed ? POINTS_PER_REWARD : 0)),
      color: m.flair?.color ?? null,
    };
    send("points-earned", payload);
  });

  useEffect(() => {
    if (!lastSale || announced.current === lastSale.orderNumber) return;
    announced.current = lastSale.orderNumber;
    void announce(lastSale);
  }, [lastSale]);

  return {
    pending,
    // Only while the check-in is still waiting (answered here, on the other
    // register, or backed out of on the screen, it's gone), or done and not
    // undone.
    arrivals: arrivals.flatMap((a) => {
      const p = pending.find((x) => x.id === a.id);
      if (p) return [{ ...a, working: p.working }];
      const r = recent.find((x) => x.id === a.id);
      return r ? [{ ...a, working: r.working }] : [];
    }),
    dismissArrival,
    now,
    here,
    notice,
    tonight,
    dupHint,
    unlimited,
    printing,
    recent,
    retry: (p) => void load(p.id, p.ref, p.kind),
    // A "known" card for an account the tablet just made is that person's
    // first visit, so the tablet greets them as new.
    confirm: (p, m, addToOrder) => void confirm(p, m, p.card?.kind === "known" && p.card.fresh === true, null, addToOrder),
    undo: (id) => void undo(id),
    visitFor,
    notMe,
    create: (p, existingId, addToOrder) => void create(p, existingId, addToOrder),
    decline,
    printTonight: () => void printTonight(),
    dismissNotice: () => setNotice(null),
    dismissTonight: () => setTonight(null),
    dismissDupHint: () => setDupHint(null),
    openOlder: () => void openOlder(),
    dismissUnlimited: () => setUnlimited(null),
    toTablet: (event, payload) => send(event, payload),
  };
}

// "Sarah M. · Just checked in", popped up over the top of the order (the
// cashier and tab rows) for 8 seconds: never over the menu buttons or the
// order's total, and nothing to answer. The face and name are big so staff
// learn names. Checked in at the screen already: where they stand and the
// one thing to know (red for no payment on file), with "Undo / Not them"
// for a mistake. Still waiting (a shared family number): a tap opens the
// Customers tab to pick who it is. Two at most, newest last.
export function CheckinArrivals({
  arrivals,
  onOpen,
  onUndo,
  onDismiss,
}: {
  arrivals: Arrival[];
  onOpen: (id: string) => void;
  onUndo: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (!arrivals.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30 grid gap-2" role="status" aria-live="polite">
      {arrivals.map((a) => (
        <div
          key={a.id}
          className="pointer-events-auto flex items-center gap-1 rounded-xl border-2 py-2 pl-3 pr-1 motion-safe:animate-arrive-in"
          style={{
            background: "var(--surface)",
            borderColor: "var(--foreground)",
            // Their favorite color down the side, as on Checked in today.
            boxShadow: `${a.color ? `inset 6px 0 0 ${a.color}, ` : ""}0 12px 28px rgb(0 0 0 / 0.3)`,
          }}
        >
          <button className="flex min-h-16 min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen(a.id)}>
            <MemberAvatar name={a.name} url={a.photo} size={60} plus={a.plus} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xl font-black leading-tight">{a.name}</span>
              {a.done ? (
                <>
                  <span
                    className={`mt-0.5 inline-block max-w-full rounded px-1.5 py-px text-sm font-bold leading-tight ${a.tone === "red" ? "text-white" : ""}`}
                    style={a.tone === "red" ? { background: NOT_ACTIVE_RED } : a.tone === "gold" ? { background: "var(--gold)", color: "var(--gold-foreground)" } : undefined}
                  >
                    {a.note}
                  </span>
                  {a.sub && <span className="block truncate text-xs tabular-nums">{a.sub}</span>}
                </>
              ) : (
                <>
                  <span className="block truncate text-sm">{a.note}</span>
                  <span className="block text-xs font-bold" style={{ color: "var(--accent)" }}>
                    Tap to pick who it is on Customers
                  </span>
                </>
              )}
            </span>
          </button>
          {a.done && (
            <button className="btn-secondary min-h-12 w-[5.5rem] shrink-0 !px-2 !py-1 text-sm font-bold leading-tight" disabled={a.working} onClick={() => onUndo(a.id)}>
              {a.working ? "Undoing…" : "Undo / Not them"}
            </button>
          )}
          <DismissButton label="Dismiss" onClick={() => onDismiss(a.id)} />
        </div>
      ))}
    </div>
  );
}

// What just happened: the confirmation, tickets to print, and the "possibly
// the same person" hint. Top of the Customers tab, where staff are when they
// confirm.
export function CheckinResults({ checkins }: { checkins: Checkins }) {
  const { notice, tonight, dupHint, printing } = checkins;
  if (!notice && !tonight && !dupHint) return null;
  return (
    <div className="space-y-2">
      {notice && (
        <div className="notice notice-success flex items-start gap-2 !p-2.5 text-sm" role="status">
          <span className="min-w-0 flex-1">{notice}</span>
          <DismissButton label="Close" onClick={checkins.dismissNotice} />
        </div>
      )}

      {tonight && <TonightTickets tonight={tonight} printing={printing} onPrint={checkins.printTonight} onDismiss={checkins.dismissTonight} />}

      {dupHint && (
        <div className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-1 text-sm" style={{ borderColor: "var(--warn-border)", background: "var(--warn-bg)" }}>
          <span className="min-w-0 flex-1" style={{ color: "var(--warn-text)" }}>
            <strong>{dupHint.name}</strong> · Possibly the same person as an older account
            {dupHint.href ? (
              <>
                :{" "}
                {/* A new tab, so the register (and its open sale) stays put.
                    The ::after makes it a full finger's height to tap. */}
                <a
                  href={dupHint.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative font-semibold underline after:absolute after:inset-x-0 after:-inset-y-3.5 after:content-['']"
                >
                  review in Back office
                </a>
              </>
            ) : (
              "; let an owner or admin know."
            )}
            {dupHint.unlimited && dupHint.olderId && (
              <>
                {" "}
                <strong>The older one has no payment on file for unlimited membership.</strong>{" "}
                <button className="relative font-semibold underline after:absolute after:inset-x-0 after:-inset-y-3.5 after:content-['']" onClick={checkins.openOlder}>
                  Put the older account on the order
                </button>
              </>
            )}
          </span>
          <DismissButton label="Dismiss" onClick={checkins.dismissDupHint} />
        </div>
      )}
    </div>
  );
}

function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="-my-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-lg leading-none" style={{ color: "var(--muted)" }} aria-label={label} onClick={onClick}>
      ×
    </button>
  );
}

// Check-ins from the customer screen that staff haven't answered yet, oldest
// first. The Customers tab's count is how many are here.
export function WaitingToConfirm({ checkins, current, hasOrder }: { checkins: Checkins; current: PosMember | null; hasOrder: boolean }) {
  const { pending, now } = checkins;
  return (
    <section aria-labelledby="checkins-waiting">
      <h2 id="checkins-waiting" className="eyebrow mb-2 flex items-center">
        Waiting to confirm{pending.length > 0 ? ` · ${pending.length}` : ""}
        <InfoTip topic="door-checkin" />
      </h2>
      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          Nobody waiting. Check-ins on the customer screen go through by themselves; only a phone number shared by a few accounts waits here for you to pick
          who it is.
        </p>
      ) : (
        <div className="grid max-w-2xl gap-3">
          {pending.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border-2 bg-[var(--surface)] text-sm" style={{ borderColor: "var(--foreground)" }}>
              <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
                <span className="font-display flex-1 text-xs uppercase tracking-wide">
                  {p.card?.kind === "known" && p.card.fresh && freshPhoneAccount(p.card)
                    ? "New phone account · just joined"
                    : p.kind === "new" || (p.card?.kind === "known" && p.card.fresh)
                      ? "New regular · just signed up"
                      : "Check-in for points"}
                </span>
                <span className="text-xs tabular-nums">{ago(Math.max(0, now - p.at))}</span>
              </div>

              <div className="space-y-2 p-3">
                {!p.card && !p.error && <div style={{ color: "var(--muted)" }}>Looking them up…</div>}

                {p.card?.kind === "known" && (
                  <KnownCard
                    card={p.card}
                    current={current}
                    hasOrder={hasOrder}
                    working={p.working}
                    onConfirm={(m, addToOrder) => checkins.confirm(p, m, addToOrder)}
                    onDecline={() => checkins.decline(p)}
                  />
                )}

                {p.card?.kind === "new" && (
                  <NewCard
                    card={p.card}
                    current={current}
                    hasOrder={hasOrder}
                    working={p.working}
                    onCreate={(addToOrder) => checkins.create(p, null, addToOrder)}
                    onAttachExisting={(id) => checkins.create(p, id, true)}
                    onCancel={() => checkins.decline(p)}
                  />
                )}

                {p.error && (
                  <>
                    <div className="text-xs" style={{ color: "var(--danger-text)" }}>
                      {p.error}
                    </div>
                    {!p.card && (
                      <div className="flex gap-2">
                        <button className="btn-secondary min-h-11 flex-1 !py-1.5" disabled={p.working} onClick={() => checkins.retry(p)}>
                          Retry
                        </button>
                        <button className="btn-secondary min-h-11 flex-1 !py-1.5" disabled={p.working} onClick={() => checkins.decline(p)}>
                          Dismiss
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Check-ins done at the customer screen in the last 15 minutes, newest
// first: who, what it paid, the one thing to know, and "Undo / Not them"
// for a mistake (the visit and its points taken back).
export function JustCheckedIn({ checkins }: { checkins: Checkins }) {
  const { recent } = checkins;
  if (!recent.length) return null;
  return (
    <section aria-labelledby="checkins-just">
      <h2 id="checkins-just" className="eyebrow mb-2">
        Just checked in on the screen · {recent.length}
      </h2>
      <ul className="grid max-w-2xl gap-2">
        {recent.slice(0, 6).map((r) => {
          const note = serviceNote(r.member, r.card);
          return (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", ...accent(r.member) }}>
              <MemberAvatar name={r.member.name} url={r.member.avatar_url} size={44} plus={memberSignal(r.member) === "plus"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold leading-tight">{r.member.name}</span>
                <span className="block truncate text-xs" style={{ color: note.tone === "red" ? "var(--danger-text)" : "var(--muted)" }}>
                  {note.text} · {visitLine(r.member, r.card)}
                </span>
              </span>
              <button className="btn-secondary min-h-11 shrink-0 !px-3 !py-1 text-sm" disabled={r.working} onClick={() => checkins.undo(r.id)}>
                {r.working ? "Undoing…" : "Undo / Not them"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Everyone checked in this business day, newest first, with big faces and
// names, so staff can greet regulars by name and put someone on an order
// when they buy later. The whole row is the button.
const HERE_FIRST = 6;

export function CheckedInToday({ here, current, onAttach }: { here: HereToday[]; current: PosMember | null; onAttach: (m: PosMember) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? here : here.slice(0, HERE_FIRST);
  return (
    <section aria-labelledby="checkins-today">
      <h2 id="checkins-today" className="eyebrow mb-2">
        Checked in today{here.length > 0 ? ` · ${here.length}` : ""}
      </h2>
      {here.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Nobody has checked in yet today.
        </p>
      ) : (
        <>
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
            {shown.map((h) => {
              const on = current?.id === h.member.id;
              return (
                <li key={h.member.id}>
                  {/* Their favorite color (lib/flair.ts), as a stripe down the left. */}
                  <button
                    className="flex min-h-16 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-default disabled:hover:bg-transparent"
                    style={{ borderColor: on ? "var(--success-border)" : "var(--border)", ...accent(h.member) }}
                    disabled={on}
                    onClick={() => onAttach(h.member)}
                  >
                    <MemberAvatar name={h.member.name} url={h.member.avatar_url} size={48} plus={memberSignal(h.member) === "plus"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold leading-tight">{h.member.name}</span>
                      <span className="block text-xs" style={{ color: "var(--muted)" }}>
                        {new Date(h.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}
                        {h.streak && h.streak > 1 ? ` · ${h.streak}-week streak` : ""}
                      </span>
                      {h.member.tagline && <span className="block truncate text-xs italic">“{h.member.tagline}”</span>}
                    </span>
                    {on ? (
                      <span className="shrink-0 text-xs font-bold" style={{ color: "var(--success-text)" }}>
                        ✓ On order
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md border-2 px-2 py-1 text-xs font-bold" style={{ borderColor: "var(--foreground)" }}>
                        Add to order
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {here.length > HERE_FIRST && (
            <button className="mt-1 min-h-11 px-1 text-sm font-bold underline" onClick={() => setAll((a) => !a)}>
              {all ? "Show fewer" : `Show all ${here.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// "🎟 2 tickets today · Print": online tickets for someone who just checked
// in. Print claims and prints them (one print per ticket, like a scan);
// tickets that already have paper show as printed.
function TonightTickets({ tonight, printing, onPrint, onDismiss }: { tonight: Tonight; printing: boolean; onPrint: () => void; onDismiss: () => void }) {
  const toPrint = tonight.tickets.filter((t) => t.printable);
  const count = tonight.tickets.reduce((n, t) => n + t.quantity, 0);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  return (
    <div className="w-full rounded-lg border-2 bg-[var(--surface)] px-3 py-1.5 text-sm" style={{ borderColor: "var(--foreground)" }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <strong>
            🎟 {firstNameOf(tonight.member.name)}: {count} ticket{count === 1 ? "" : "s"} today
          </strong>
        </span>
        {toPrint.length > 0 ? (
          <button className="btn-primary min-h-11 shrink-0 !px-4 !py-1.5" disabled={printing} onClick={onPrint}>
            {printing ? "Printing…" : "Print"}
          </button>
        ) : (
          <span className="shrink-0 text-xs font-bold" style={{ color: "var(--muted)" }}>
            Printed
          </span>
        )}
        <DismissButton label="Dismiss" onClick={onDismiss} />
      </div>
      <ul className="mb-1 space-y-0.5 text-xs" style={{ color: "var(--muted)" }}>
        {tonight.tickets.map((t) => (
          <li key={t.bookingId}>
            {t.quantity}× {t.title} · {time(t.startsAt)} · {t.room}
            {t.printable ? "" : " · printed"}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Big face and name, so staff can put the two together and greet them by
// name next time. Their profile line, if they wrote one (and staff haven't
// hidden it).
function Face({ m, phoneLast4, byEmail }: { m: PosMember; phoneLast4?: string; byEmail?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <MemberAvatar name={m.name} url={m.avatar_url} size={96} plus={memberSignal(m) === "plus"} />
      <div className="min-w-0 flex-1">
        <div className="text-2xl font-black leading-tight">{m.name}</div>
        <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
          {phoneLast4 ? `Phone ending ${phoneLast4} · ` : byEmail ? "By email · " : ""}
          {m.tier} · {pts(m.points)}
          {m.phoneOnly && (
            <>
              {" "}
              <PhoneOnlyTag />
            </>
          )}
        </div>
        {m.tagline && <div className="mt-1 text-sm italic leading-snug">“{m.tagline}”</div>}
      </div>
    </div>
  );
}

// A phone account (lib/member-name.ts): just a number, no email or login.
export function PhoneOnlyTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-px align-middle text-[10px] font-bold uppercase tracking-wide"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      title="Phone account: just their phone number, no email or website login"
    >
      📞 phone only
    </span>
  );
}

// A former unlimited member (lib/legacy-plus.ts), before staff confirm:
// once they're checked in, the card to set it up shows above.
// Red NOT ACTIVE, never gold: gold means active Insiders+ (member-signal.ts).
function UnlimitedFlag() {
  return (
    <div className="flex items-center gap-2 rounded-md border-2 px-2.5 py-1.5 text-sm font-bold leading-tight text-white" style={{ borderColor: "var(--foreground)", background: NOT_ACTIVE_RED }}>
      <NotActiveStamp />
      <span className="min-w-0 flex-1">No payment on file for unlimited membership</span>
    </div>
  );
}

function OrderNote({ current, target, hasOrder }: { current: PosMember | null; target: PosMember; hasOrder: boolean }) {
  if (current?.id === target.id) return <p className="text-xs" style={{ color: "var(--muted)" }}>Already on this order.</p>;
  if (current)
    return (
      <p className="text-xs" style={{ color: "var(--warn-text)" }}>
        Replaces {current.name} on this order.
      </p>
    );
  if (!hasOrder)
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        No order open: they&apos;ll go on the next one you ring up.
      </p>
    );
  return null;
}

function ConfirmButtons({ working, hasOrder, onConfirm, onNo, noLabel }: { working: boolean; hasOrder: boolean; onConfirm: (addToOrder: boolean) => void; onNo: () => void; noLabel: string }) {
  return (
    <div className="grid gap-2">
      <button className="btn-primary w-full !py-3 !text-base" disabled={working} onClick={() => onConfirm(false)}>
        {working ? "Checking in…" : "✓ Check in"}
      </button>
      <div className="flex gap-2">
        <button className="btn-secondary min-h-11 flex-[3] !px-3 !py-2" disabled={working} onClick={() => onConfirm(true)}>
          Check in + {hasOrder ? "add to this order" : "next order"}
        </button>
        <button className="btn-secondary min-h-11 flex-[2] !px-3 !py-2" disabled={working} onClick={onNo}>
          {noLabel}
        </button>
      </div>
    </div>
  );
}

function KnownCard({
  card,
  current,
  hasOrder,
  working,
  onConfirm,
  onDecline,
}: {
  card: Extract<CheckinCard, { kind: "known" }>;
  current: PosMember | null;
  hasOrder: boolean;
  working: boolean;
  onConfirm: (m: PosMember, addToOrder: boolean) => void;
  onDecline: () => void;
}) {
  if (card.matches.length === 1) {
    const m = card.matches[0];
    return (
      <>
        <Face m={m} phoneLast4={card.phoneLast4} byEmail={card.byEmail} />
        {card.addPhone && (
          <p className="rounded-md border px-2.5 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            📱 Will add phone {card.addPhone}
            <span className="font-normal" style={{ color: "var(--muted)" }}>
              {" "}
              on check-in
            </span>
          </p>
        )}
        {card.addName && (
          <p className="rounded-md border px-2.5 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            ✏️ Will add name {card.addName}
            <span className="font-normal" style={{ color: "var(--muted)" }}>
              {" "}
              on check-in
            </span>
          </p>
        )}
        {m.legacyUnlimited && <UnlimitedFlag />}
        <OrderNote current={current} target={m} hasOrder={hasOrder} />
        <ConfirmButtons working={working} hasOrder={hasOrder} onConfirm={(add) => onConfirm(m, add)} onNo={onDecline} noLabel="Not them" />
      </>
    );
  }

  // A shared (family) number: staff pick the face in front of them.
  return (
    <>
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        {card.matches.length} accounts have the phone ending {card.phoneLast4}. Which one is it?
      </div>
      {card.matches.map((m) => (
        <div key={m.id} className="flex items-center gap-2">
          <MemberAvatar name={m.name} url={m.avatar_url} size={44} plus={memberSignal(m) === "plus"} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{m.name}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {m.tier} · {pts(m.points)}
              {current?.id === m.id ? " · on this order" : ""}
            </div>
            {m.legacyUnlimited && (
              <div className="text-xs font-bold" style={{ color: "var(--danger-text)" }}>
                Not active: no payment on file for unlimited
              </div>
            )}
          </div>
          <button className="btn-primary min-h-11 shrink-0 !px-4 !py-1.5" disabled={working} onClick={() => onConfirm(m, false)}>
            Check in
          </button>
        </div>
      ))}
      {current && !card.matches.some((m) => m.id === current.id) && (
        <p className="text-xs" style={{ color: "var(--warn-text)" }}>
          Attaching replaces {current.name} on this order.
        </p>
      )}
      {!current && !hasOrder && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          No order open: they&apos;ll go on the next one you ring up.
        </p>
      )}
      <button className="btn-secondary min-h-11 w-full !py-2" disabled={working} onClick={onDecline}>
        None of them
      </button>
    </>
  );
}

function NewCard({
  card,
  current,
  hasOrder,
  working,
  onCreate,
  onAttachExisting,
  onCancel,
}: {
  card: Extract<CheckinCard, { kind: "new" }>;
  current: PosMember | null;
  hasOrder: boolean;
  working: boolean;
  onCreate: (addToOrder: boolean) => void;
  onAttachExisting: (id: string) => void;
  onCancel: () => void;
}) {
  const match = card.emailMatch;
  return (
    <>
      <div className="text-2xl font-black leading-tight">{card.firstName}</div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        New regular · {card.phone}
      </div>
      {card.email && (
        <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
          {card.email} · {card.emailOptIn ? "wants our emails" : "no marketing emails"}
        </div>
      )}
      {current && (
        <p className="text-xs" style={{ color: "var(--warn-text)" }}>
          Replaces {current.name} on this order.
        </p>
      )}
      {match ? (
        <>
          <div className="rounded-md border p-2" style={{ borderColor: "var(--warn-border)", background: "var(--warn-bg)" }}>
            <div className="mb-1.5 text-xs" style={{ color: "var(--warn-text)" }}>
              That email is already on an account. If this is them, attach it (and their number goes on it):
            </div>
            <div className="flex items-center gap-2">
              <MemberAvatar name={match.name} url={match.avatar_url} size={40} plus={memberSignal(match) === "plus"} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{match.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {phoneEnding(match)} · {pts(match.points)}
                </div>
              </div>
              <button className="btn-primary min-h-11 shrink-0 !px-4 !py-1.5" disabled={working} onClick={() => onAttachExisting(match.id)}>
                Attach {firstNameOf(match.name)}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary min-h-11 flex-1 !py-2" disabled={working} onClick={() => onCreate(false)}>
              {working ? "Working…" : "Create new"}
            </button>
            <button className="btn-secondary min-h-11 flex-1 !py-2" disabled={working} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <ConfirmButtons working={working} hasOrder={hasOrder} onConfirm={onCreate} onNo={onCancel} noLabel="Cancel" />
      )}
    </>
  );
}

function accent(m: PosMember): React.CSSProperties | undefined {
  const c = flairColor(m.flair?.color);
  return c ? { boxShadow: `inset 5px 0 0 ${c.hex}` } : undefined;
}
