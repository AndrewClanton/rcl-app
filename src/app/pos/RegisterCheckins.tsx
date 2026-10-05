"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MemberAvatar from "@/components/MemberAvatar";
import InfoTip from "@/components/help/InfoTip";
import { checkinTopic, firstNameOf, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import type { ReceiptData } from "@/lib/print/receipt";
import { POINTS_PER_REWARD } from "@/lib/loyalty";
import { badgeFor } from "@/lib/visits";
import { flairColor } from "@/lib/flair";
import { getDuplicateHint, getHereToday, resolveCheckin, undoCheckin, type CheckinCard, type HereToday } from "./checkin-actions";
import { getPosMember, type PosMember } from "./member-actions";
import { getMemberTicketsToday } from "./scan-actions";
import { printDoorTickets } from "./door-print";
import { usePrintTarget } from "./printing";
import { tabletTickets, type CheckinTickets, type DoorTicket } from "@/lib/door-tickets";
import { NOT_ACTIVE_RED, type TabletSend } from "./LegacyPlusCard";
import { memberSignal, memberStanding } from "./member-signal";
import { shortName } from "@/lib/card-match";
import type { VisitWaiting } from "./PosMemberPanel";
import MemberGlance, { HOLD_CLASS, useLongPress } from "./MemberGlance";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

type Tonight = { member: PosMember; tickets: DoorTicket[] };
// olderId/unlimited: the older account paid for unlimited on the old site
// and has nothing paying here (lib/legacy-plus.ts), so staff can open it to
// set that up (the tablet couldn't find it: usually no phone on file).
type DupHint = { name: string; href: string | null; olderId: string | null; unlimited: boolean };

// A request's sealed reference stops working after 15 minutes (see
// lib/checkin-server.ts), so its Undo goes then too.
const LIFETIME_MS = 15 * 60_000;
const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

// When something happened (a request arrived). Only ever called from event
// handlers, never while rendering.
const clock = () => Date.now();

function pts(n: number) {
  const r = Math.round(n);
  return `${r.toLocaleString("en-US")} pt${r === 1 ? "" : "s"}`;
}

// A check-in that just came in from the customer screen, popped up over the
// top of the order (CheckinArrivals): their face and name, big, so staff
// put the two together, and what staff need to give great service (where
// they stand and the one most useful thing to know or do, serviceNote).
// Nothing to reverse: the register has no reversal buttons (Andrew, 10/2);
// something wrong is flagged from the press-and-hold panel (MemberGlance).
export interface Arrival {
  id: string; // the check-in's
  name: string; // "Sarah M."
  photo: string | null;
  plus: boolean; // Insiders+ that's paid for: the gold ring
  color: string | null; // their favorite color (lib/flair.ts), a stripe down the side
  note: string;
  tone?: "red" | "gold" | null; // the note's: red for no payment on file
  sub?: string; // "+5 pts · 140 pts · 🔥 3 weeks"
}

// Up this long, at most this many at once (the newest), and gone as soon
// as the guest says "That's not me" on the screen.
const ARRIVAL_MS = 12_000;
const ARRIVALS_MAX = 2;

// A check-in done at the screen (its visit recorded and paid there), kept
// while its sealed reference lasts, for the Member box and the guest's own
// "That's not me" on the screen. auto: it put them on the order.
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

function arrivalFor(id: string, m: PosMember, card: Extract<CheckinCard, { kind: "known" }>): Arrival {
  const note = serviceNote(m, card);
  return {
    id,
    name: shortName(m.name),
    photo: m.avatar_url,
    plus: memberSignal(m) === "plus",
    color: flairColor(m.flair?.color)?.hex ?? null,
    note: note.text,
    tone: note.tone,
    sub: visitLine(m, card),
  };
}

export interface Checkins {
  // The latest check-ins, popped up over the order.
  arrivals: Arrival[];
  dismissArrival: (id: string) => void;
  here: HereToday[];
  notice: string | null;
  tonight: Tonight | null;
  dupHint: DupHint | null;
  // A former unlimited member just checked in with no payment on file
  // (lib/legacy-plus.ts): the card to set it up, top of the Customers tab.
  unlimited: PosMember | null;
  printing: boolean;
  // The member on the order's check-in from the screen, for the order's
  // Member box.
  visitFor: (memberId: string | null) => VisitWaiting | null;
  // The guest tapped "That's not me" under their card on the customer
  // screen (PosApp has taken them off the order): the check-in that put
  // them there is undone too.
  notMe: (memberId: string) => void;
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
// there's nothing for staff to confirm, and a phone number shared by a few
// accounts asks "Which one is you?" on the screen itself. Here it goes
// straight onto the order, the latest one in taking over from whoever was
// on it (autoAttach, PosApp: never mid-payment), and the pop-up shows who
// it is and the one thing to know (serviceNote). The register reverses
// nothing (Andrew, 10/2): only the guest's "That's not me" on the screen
// takes the visit and its points back (notMe). Staff who think something's
// wrong flag the account from the press-and-hold panel (MemberGlance).
//
// Everyone checked in today is listed under "Checked in today", faces
// first, so staff learn names and can put someone on an order with one
// tap. When a sale with a member on it completes, this tells the customer
// screen to play the points burst.
export function useRegisterCheckins({
  registerTopic,
  member,
  onAttach,
  autoAttach,
  lastSale,
}: {
  registerTopic: string;
  member: PosMember | null;
  onAttach: (m: PosMember) => void;
  // Puts them on the order: true if it did.
  autoAttach?: (m: PosMember) => boolean;
  lastSale: ReceiptData | null;
}): Checkins {
  const [notice, setNotice] = useState<string | null>(null);
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
  // again, and every request being looked up (screens resend until seen).
  const answered = useRef(new Map<string, { event: string; payload: object }>());
  const shown = useRef(new Set<string>());
  // Check-ins done at the screen, newest first.
  const [recent, setRecent] = useState<RecentCheckin[]>([]);
  // The latest autoAttach (a lookup finishes after the render it began in).
  const autoRef = useRef(autoAttach);
  useEffect(() => {
    autoRef.current = autoAttach;
  });

  function send(event: string, payload: object) {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }

  function remember(id: string, event: string, payload: object) {
    answered.current.set(id, { event, payload });
    if (answered.current.size > 50) answered.current.delete(answered.current.keys().next().value as string);
  }

  function answer(id: string, event: string, payload: object) {
    remember(id, event, payload);
    send(event, payload);
  }

  // A request from the screen: who it is, checked in there already (its
  // visit recorded and paid): straight to `recent`, on the order, and a
  // pop-up for staff. A lookup that couldn't finish is tried again when the
  // screen resends it (every few seconds until it's seen).
  async function load(id: string, ref: string) {
    const r = await resolveCheckin(ref).catch(() => null);
    if (!r || (!r.ok && r.retry)) {
      shown.current.delete(id);
      return;
    }
    if (!r.ok) {
      // Too old to use: the screen has long since moved on.
      if (r.expired) return answer(id, "checkin-declined", { id });
      answer(id, "checkin-seen", { id });
      return setNotice(`A check-in from the customer screen: ${r.error}`);
    }
    if (r.card.kind === "known" && r.card.done && r.card.matches.length === 1) return checkedIn(id, ref, r.card);
    // Not checked in at the screen: one from a customer screen that hasn't
    // updated yet (it used to leave a shared family number to staff). It
    // tells them to see the box office; they type their number again once
    // it's updated, or staff find them by name.
    answer(id, "checkin-declined", { id });
    setNotice("A check-in on the customer screen didn't go through. Ask them to type their number again, or find them by name.");
  }

  // Checked in at the screen: seen (so it stops resending), on the order
  // (the latest one in takes over, unless it's mid-payment), a pop-up with
  // what staff need to know, and the follow-ups.
  function checkedIn(id: string, ref: string, card: Extract<CheckinCard, { kind: "known" }>) {
    const m = card.matches[0];
    answer(id, "checkin-seen", { id });
    const auto = fresh(card) && !!autoRef.current?.(m);
    setRecent((rs) => [{ id, ref, at: clock(), member: m, card, auto, working: false }, ...rs.filter((x) => x.id !== id)].slice(0, 12));
    arrive(arrivalFor(id, m, card));
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
    setTimeout(() => dismissArrival(a.id), ARRIVAL_MS);
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

  // "That's not me" on the screen: the check-in's visit and its points taken
  // back (undoCheckin). PosApp has taken them off the order already.
  async function undo(id: string) {
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
    setNotice(`${rec.member.name}: ${r.note}`);
    void refreshHere();
  }

  function dismissArrival(id: string) {
    setArrivals((as) => as.filter((a) => a.id !== id));
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

  function visitFor(memberId: string | null): VisitWaiting | null {
    if (!memberId) return null;
    const rec = recent.find((r) => r.member.id === memberId);
    if (!rec) return null;
    return { auto: rec.auto, line: visitLine(rec.member, rec.card) };
  }

  // "That's not me" on the customer screen: the check-in that put them on
  // the order is undone (its visit and points).
  function notMe(memberId: string) {
    for (const r of recent) if (r.member.id === memberId && r.auto) void undo(r.id);
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
    const { id, ref } = raw;
    const done = answered.current.get(id);
    if (done) return send(done.event, done.payload);
    // Being looked up already.
    if (shown.current.has(id)) return;
    shown.current.add(id);
    void load(id, ref);
  });

  // Another register answered it first.
  const onAnsweredElsewhere = useEffectEvent((payload: { id?: unknown } | null, event: string) => {
    if (!payload || typeof payload.id !== "string") return;
    remember(payload.id, event, payload);
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

  // Done check-ins go with their sealed reference.
  useEffect(() => {
    if (!recent.length) return;
    const timer = setInterval(() => {
      const t = clock();
      setRecent((rs) => (rs.some((r) => t - r.at >= LIFETIME_MS) ? rs.filter((r) => t - r.at < LIFETIME_MS) : rs));
    }, 30_000);
    return () => clearInterval(timer);
  }, [recent.length]);

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
    // Only while the check-in stands ("That's not me" on the screen, it's gone).
    arrivals: arrivals.filter((a) => recent.some((x) => x.id === a.id)),
    dismissArrival,
    here,
    notice,
    tonight,
    dupHint,
    unlimited,
    printing,
    visitFor,
    notMe,
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
// cashier and tab rows) for 12 seconds: never over the menu buttons or the
// order's total, and nothing to answer. The face and name are big so staff
// learn names, with where they stand and the one thing to know (red for no
// payment on file). A tap opens the Customers tab. Two at most, newest last.
export function CheckinArrivals({ arrivals, onOpen, onDismiss }: { arrivals: Arrival[]; onOpen: (id: string) => void; onDismiss: (id: string) => void }) {
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
              <span
                className={`mt-0.5 inline-block max-w-full rounded px-1.5 py-px text-sm font-bold leading-tight ${a.tone === "red" ? "text-white" : ""}`}
                style={a.tone === "red" ? { background: NOT_ACTIVE_RED } : a.tone === "gold" ? { background: "var(--gold)", color: "var(--gold-foreground)" } : undefined}
              >
                {a.note}
              </span>
              {a.sub && <span className="block truncate text-xs tabular-nums">{a.sub}</span>}
            </span>
          </button>
          <DismissButton label="Dismiss" onClick={() => onDismiss(a.id)} />
        </div>
      ))}
    </div>
  );
}

// What just happened: the latest check-in, tickets to print, and the
// "possibly the same person" hint. Top of the Customers tab.
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

// Everyone checked in this business day, newest first, with big faces and
// names, so staff can greet regulars by name and put someone on an order
// when they buy later. The whole card is the button; held for half a
// second, it shows their account at a glance instead (MemberGlance), where
// staff can flag it. A flagged account shows a small 🚩 (it blocks nothing).
const HERE_FIRST = 6;

export function CheckedInToday({
  here,
  current,
  onAttach,
  employeeId,
}: {
  here: HereToday[];
  current: PosMember | null;
  onAttach: (m: PosMember) => void;
  employeeId: string;
}) {
  const [all, setAll] = useState(false);
  const [glance, setGlance] = useState<PosMember | null>(null);
  // Flagged here since the list was read (it's read again every couple of minutes).
  const [flaggedNow, setFlaggedNow] = useState<ReadonlySet<string>>(new Set());
  // Organizations set here since the list was read (null: removed).
  const [orgNow, setOrgNow] = useState<ReadonlyMap<string, string | null>>(new Map());
  const hold = useLongPress();
  const shown = all ? here : here.slice(0, HERE_FIRST);
  return (
    <section aria-labelledby="checkins-today">
      <h2 id="checkins-today" className="eyebrow mb-2 flex items-center">
        Checked in today{here.length > 0 ? ` · ${here.length}` : ""}
        <InfoTip topic="door-checkin" />
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
              const org = orgNow.has(h.member.id) ? orgNow.get(h.member.id) : h.organization;
              return (
                <li key={h.member.id}>
                  {/* Their favorite color (lib/flair.ts), as a stripe down the
                      left. Already on the order: still holdable, so not
                      disabled, just nothing to add. */}
                  <button
                    className={`flex min-h-16 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${HOLD_CLASS} ${on ? "cursor-default" : "hover:bg-[var(--surface-hover)]"}`}
                    style={{ borderColor: on ? "var(--success-border)" : "var(--border)", ...accent(h.member) }}
                    aria-disabled={on}
                    onClick={() => {
                      if (!on) onAttach(h.member);
                    }}
                    {...hold(() => setGlance(h.member))}
                  >
                    <MemberAvatar name={h.member.name} url={h.member.avatar_url} size={48} plus={memberSignal(h.member) === "plus"} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="min-w-0 truncate font-bold leading-tight">{h.member.name}</span>
                        {(h.flagged || flaggedNow.has(h.member.id)) && (
                          <span className="shrink-0 text-xs" title="Flagged for an admin to look at" aria-label="Flagged">
                            🚩
                          </span>
                        )}
                      </span>
                      {org && (
                        <span className="mt-0.5 inline-block max-w-full truncate rounded-full border px-1.5 text-[11px] font-bold leading-4" style={{ borderColor: "var(--border)" }} title="Group / organization (staff only)">
                          🏷 {org}
                        </span>
                      )}
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
      {glance && (
        <MemberGlance
          key={glance.id}
          member={glance}
          employeeId={employeeId}
          onClose={() => setGlance(null)}
          onFlagged={(id) => setFlaggedNow((s) => new Set(s).add(id))}
          onOrganization={(id, org) => setOrgNow((s) => new Map(s).set(id, org))}
        />
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

function accent(m: PosMember): React.CSSProperties | undefined {
  const c = flairColor(m.flair?.color);
  return c ? { boxShadow: `inset 5px 0 0 ${c.hex}` } : undefined;
}
