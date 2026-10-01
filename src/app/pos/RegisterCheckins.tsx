"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MemberAvatar from "@/components/MemberAvatar";
import InfoTip from "@/components/help/InfoTip";
import { checkinTopic, firstNameOf, last10, type CheckinConfirmed, type CheckinKind, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import type { ReceiptData } from "@/lib/print/receipt";
import { POINTS_PER_REWARD } from "@/lib/loyalty";
import { REWARD_LABEL, badgeList } from "@/lib/visits";
import { entranceFor, flairColor, parseFlair } from "@/lib/flair";
import { confirmVisit, createCheckinMember, getDuplicateHint, getHereToday, resolveCheckin, type CheckinCard, type HereToday } from "./checkin-actions";
import { getPosMember, type PosMember } from "./member-actions";
import { getMemberTicketsToday } from "./scan-actions";
import { printDoorTickets } from "./door-print";
import { usePrintTarget } from "./printing";
import { tabletTickets, type CheckinTickets, type DoorTicket } from "@/lib/door-tickets";
import { NOT_ACTIVE_RED, NotActiveStamp, type TabletSend } from "./LegacyPlusCard";

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

export interface Checkins {
  pending: Pending[];
  now: number;
  here: HereToday[];
  notice: string | null;
  tonight: Tonight | null;
  dupHint: DupHint | null;
  // A former unlimited member just checked in with no payment on file
  // (lib/legacy-plus.ts): the card to set it up, top of the Customers tab.
  unlimited: PosMember | null;
  printing: boolean;
  retry: (p: Pending) => void;
  confirm: (p: Pending, m: PosMember, addToOrder: boolean) => void;
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
// on screen: it listens for check-ins, keeps them until staff answer, and
// tells the customer screen what happened. What staff see lives on the
// register's Customers tab (CustomersTab.tsx), and the tab's count shows how
// many are waiting, so nothing floats over the menu buttons.
//
// A check-in waits as a card -- photo, full name, last four of the phone --
// for staff to Check in (that's them) or say Not them. A number we don't
// know shows as "New regular" with Create. Cards wait up to 15 minutes, and
// if there's no order open yet, "+ order" puts them on the next one. When a
// sale with a member on it completes, this tells the customer screen to play
// the points burst.
//
// Confirming is a visit (lib/visits.ts): Check in pays the check-in's points
// and any new badges without touching the order, so a group can check in as
// they walk in and buy later; "+ add to order" also puts them on the order.
// Everyone checked in today is listed under "Checked in today", faces first,
// so staff learn names and can put someone on an order with one tap.
export function useRegisterCheckins({
  registerTopic,
  member,
  onAttach,
  hasOrder,
  lastSale,
}: {
  registerTopic: string;
  member: PosMember | null;
  onAttach: (m: PosMember) => void;
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
  const printTarget = usePrintTarget();
  const channelRef = useRef<Channel | null>(null);
  // Requests answered here, so a screen that missed the answer can get it
  // again, and every request already on screen (screens resend until seen).
  const answered = useRef(new Map<string, { event: string; payload: object }>());
  const shown = useRef(new Set<string>());

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
  }

  async function load(id: string, ref: string) {
    patch(id, { error: null, working: true });
    const r = await resolveCheckin(ref).catch(() => null);
    if (!r) return patch(id, { working: false, error: OFFLINE });
    if (!r.ok) {
      // Too old to use: the screen has long since moved on.
      if (r.expired) return answer(id, "checkin-declined", { id });
      return patch(id, { working: false, error: r.error });
    }
    patch(id, { working: false, card: r.card });
    send("checkin-seen", { id });
  }

  // Staff said "that's them": today's visit (its points, maybe badges and
  // a reward), and with addToOrder, onto the order too.
  async function confirm(p: Pending, m: PosMember, isNew: boolean, note: string | null, addToOrder: boolean) {
    patch(p.id, { working: true, error: null });
    const r = await confirmVisit(m.id).catch(() => null);
    const visit = r?.ok ? r.visit : null;
    const already = member?.id === m.id;
    if (addToOrder) onAttach(m);
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
    // Their tickets for today, if they bought any online: a Print row on the
    // Customers tab, and the tickets on the customer screen. A separate
    // message, so the confirmation above never waits on it.
    void getMemberTicketsToday(m.id)
      .then((t) => {
        if (!t.ok || t.tickets.length === 0) return;
        setTonight({ member: m, tickets: t.tickets });
        const shown: CheckinTickets = { id: p.id, firstName: firstNameOf(m.name), tickets: tabletTickets(t.tickets) };
        send("checkin-tickets", shown);
      })
      .catch(() => {});
    // Possibly a second account for an older member (made at the tablet,
    // same name, the old one has no usable phone). Also its own message,
    // after the confirmation.
    setDupHint(null);
    void getDuplicateHint(m.id)
      .then((h) => {
        if (h) setDupHint({ name: m.name, href: h.href, olderId: h.olderId, unlimited: h.unlimited });
      })
      .catch(() => {});
    // No payment on file for their unlimited membership: the card to set it
    // up goes to the top of the Customers tab.
    setUnlimited(m.legacyUnlimited ? m : null);
    const bits = [isNew ? `New regular ${m.name} is set up and checked in.` : `${m.name} checked in.`];
    if (visit?.alreadyToday) bits.push("Already checked in today, so no new points.");
    else if (visit) bits.push(`+${visit.visitPoints} pts${visit.weekStreak > 1 ? `, ${visit.weekStreak}-week streak` : ""}.`);
    else bits.push("Their visit points didn't save; check them in again later.");
    if (visit?.badges.length) bits.push(`New badge${visit.badges.length === 1 ? "" : "s"}: ${badgeList(visit.badges)}.`);
    for (const r of visit?.rewards ?? []) bits.push(`They earned: ${REWARD_LABEL[r]}! Redeem it from their member panel.`);
    if (addToOrder) bits.push(already ? "Already on this order." : hasOrder ? "On this order." : "They'll be on the next order.");
    if (note) bits.push(note);
    setNotice(bits.join(" "));
    void refreshHere();
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

  function decline(p: Pending) {
    answer(p.id, "checkin-declined", { id: p.id });
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
    setPending((ps) => [...ps, { id, ref, kind, at, card: null, error: null, working: true }]);
    void load(id, ref);
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

  // Keeps the "n min ago" labels current, and lets old cards go.
  useEffect(() => {
    if (!pending.length) return;
    const timer = setInterval(() => {
      const t = clock();
      setNow(t);
      setPending((ps) => ps.filter((p) => t - p.at < LIFETIME_MS));
    }, 30_000);
    return () => clearInterval(timer);
  }, [pending.length]);

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
    now,
    here,
    notice,
    tonight,
    dupHint,
    unlimited,
    printing,
    retry: (p) => void load(p.id, p.ref),
    // A "known" card for an account the tablet just made is that person's
    // first visit, so the tablet greets them as new.
    confirm: (p, m, addToOrder) => void confirm(p, m, p.card?.kind === "known" && p.card.fresh === true, null, addToOrder),
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
          Nobody waiting. When someone checks in on the customer screen, they show up here for you to confirm.
        </p>
      ) : (
        <div className="grid max-w-2xl gap-3">
          {pending.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border-2 bg-[var(--surface)] text-sm" style={{ borderColor: "var(--foreground)" }}>
              <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
                <span className="font-display flex-1 text-xs uppercase tracking-wide">
                  {p.kind === "new" || (p.card?.kind === "known" && p.card.fresh) ? "New regular · just signed up" : "Check-in for points"}
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
                    <MemberAvatar name={h.member.name} url={h.member.avatar_url} size={48} plus={h.member.tier === "Insiders+"} />
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
function Face({ m, phoneLast4 }: { m: PosMember; phoneLast4?: string }) {
  return (
    <div className="flex items-center gap-3">
      <MemberAvatar name={m.name} url={m.avatar_url} size={96} plus={m.tier === "Insiders+" && !m.legacyUnlimited} />
      <div className="min-w-0 flex-1">
        <div className="text-2xl font-black leading-tight">{m.name}</div>
        <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
          {phoneLast4 ? `Phone ending ${phoneLast4} · ` : ""}
          {m.tier} · {pts(m.points)}
        </div>
        {m.tagline && <div className="mt-1 text-sm italic leading-snug">“{m.tagline}”</div>}
      </div>
    </div>
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
        <Face m={m} phoneLast4={card.phoneLast4} />
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
          <MemberAvatar name={m.name} url={m.avatar_url} size={44} plus={m.tier === "Insiders+" && !m.legacyUnlimited} />
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
              <MemberAvatar name={match.name} url={match.avatar_url} size={40} plus={match.tier === "Insiders+"} />
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
