"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MemberAvatar from "@/components/MemberAvatar";
import { checkinTopic, firstNameOf, last10, type CheckinConfirmed, type CheckinKind, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import type { ReceiptData } from "@/lib/print/receipt";
import { REWARD_LABEL } from "@/lib/visits";
import { confirmVisit, createCheckinMember, getHereToday, resolveCheckin, type CheckinCard, type HereToday } from "./checkin-actions";
import { getPosMember, type PosMember } from "./member-actions";
import { getMemberTicketsToday } from "./scan-actions";
import { printDoorTickets } from "./door-print";
import { useDeviceSettings } from "./devices/settings";
import { tabletTickets, type CheckinTickets, type DoorTicket } from "@/lib/door-tickets";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

interface Pending {
  id: string;
  ref: string;
  kind: CheckinKind;
  at: number;
  card: CheckinCard | null; // null while it's being looked up
  error: string | null;
  working: boolean;
}

// A request's sealed reference stops working after 15 minutes (see
// lib/checkin-server.ts), so its card goes then too. The "checked in"
// reminder lasts as long.
const LIFETIME_MS = 15 * 60_000;
const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

// When something happened (a request arrived, a check-in was attached).
// Only ever called from event handlers, never while rendering.
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

// The register's side of "Check in for points" on the customer screen.
// A check-in shows here as a card -- photo, full name, last four of the
// phone -- for staff to Attach (puts the member on the order, the same as
// the Member search does) or say Not them. A number we don't know shows as
// "New regular" with Create & attach. It floats over the register rather
// than blocking it, and waits (up to 15 minutes) if there's no order open
// yet: Attach then puts them on the next one. When a sale with a member on
// it completes, this tells the customer screen to play the points burst.
//
// PosApp passes the order's member and its setter, whether an order is open,
// and the last sale's receipt (how this hears a sale completed).
//
// Confirming is a visit (lib/visits.ts): Check in pays today's streak
// points without touching the order, so a group can check in as they walk
// in and buy later; "+ add to order" also puts them on the order. Everyone
// checked in today is under "Here today", faces first, so staff learn names
// and can put someone on an order with one tap.
export default function RegisterCheckins({
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
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The latest check-in, until a sale goes through: if the order's member
  // gets cleared first (New tab, Clear), one tap puts them back.
  const [recent, setRecent] = useState<{ member: PosMember; at: number } | null>(null);
  const [now, setNow] = useState(0);
  const [here, setHere] = useState<HereToday[]>([]);
  const [hereOpen, setHereOpen] = useState(false);
  // Tickets bought online for today by whoever just checked in: one tap
  // prints them, instead of scanning.
  const [tonight, setTonight] = useState<{ member: PosMember; tickets: DoorTicket[] } | null>(null);
  const [printing, setPrinting] = useState(false);
  const devices = useDeviceSettings();
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

  // Staff said "that's them": today's visit (streak points, maybe a
  // reward), and with addToOrder, onto the order too.
  async function confirm(p: Pending, m: PosMember, isNew: boolean, note: string | null, addToOrder: boolean) {
    patch(p.id, { working: true, error: null });
    const r = await confirmVisit(m.id).catch(() => null);
    const visit = r?.ok ? r.visit : null;
    const already = member?.id === m.id;
    if (addToOrder) {
      onAttach(m);
      setRecent({ member: m, at: clock() });
    }
    const confirmed: CheckinConfirmed = {
      id: p.id,
      firstName: firstNameOf(m.name),
      points: Math.round(visit ? visit.balance : m.points),
      isNew,
      ...(visit ? { visit: { earned: visit.earned, streak: visit.streak, alreadyToday: visit.alreadyToday, reward: visit.reward } } : {}),
      // No website login yet: the tablet shows a QR code to set one up.
      ...(r?.ok && r.claimUrl ? { claimUrl: r.claimUrl } : {}),
    };
    answer(p.id, "checkin-confirmed", confirmed);
    // Their tickets for today, if they bought any online: a Print row here,
    // and the tickets on the customer screen. A separate message, so the
    // confirmation above never waits on it.
    void getMemberTicketsToday(m.id)
      .then((t) => {
        if (!t.ok || t.tickets.length === 0) return;
        setTonight({ member: m, tickets: t.tickets });
        const shown: CheckinTickets = { id: p.id, firstName: firstNameOf(m.name), tickets: tabletTickets(t.tickets) };
        send("checkin-tickets", shown);
      })
      .catch(() => {});
    const bits = [isNew ? `New regular ${m.name} is set up and checked in.` : `${m.name} checked in.`];
    if (visit?.alreadyToday) bits.push("Already checked in today, so no new points.");
    else if (visit) bits.push(`Day ${visit.streak} streak, +${visit.earned} pts.`);
    else bits.push("Their visit points didn't save; check them in again later.");
    if (visit?.reward) bits.push(`They earned: ${REWARD_LABEL[visit.reward]}! Redeem it from their member panel.`);
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
      const r = await printDoorTickets(devices.printerAddress, t.bookingId).catch(() => null);
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
    setCollapsed(false);
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

  // Here today: on load, then every couple of minutes.
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

  // Keeps the "n min ago" labels current, and lets old cards (and the
  // checked-in reminder) go.
  useEffect(() => {
    if (!pending.length && !recent) return;
    const timer = setInterval(() => {
      const t = clock();
      setNow(t);
      setPending((ps) => ps.filter((p) => t - p.at < LIFETIME_MS));
      setRecent((r) => (r && t - r.at < LIFETIME_MS ? r : null));
    }, 30_000);
    return () => clearInterval(timer);
  }, [pending.length, recent]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Points on the customer screen. PosApp clears the member in the same
  // update that records the sale, so remember who was on the order; the
  // receipt names them if they were still on it when it was paid. Points are
  // 1 per $1 of the subtotal (completeOrder), and the balance is read back
  // fresh so any reward used on the order is counted.
  const lastMember = useRef<PosMember | null>(null);
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (member) lastMember.current = member;
  }, [member]);

  const announce = useEffectEvent(async (sale: ReceiptData) => {
    setRecent(null);
    const m = lastMember.current;
    const earned = Math.round(sale.subtotal);
    if (!m || sale.member !== m.name || earned < 1) return;
    const fresh = await getPosMember(m.id).catch(() => null);
    const payload: PointsEarned = {
      orderNumber: sale.orderNumber,
      firstName: firstNameOf(m.name),
      earned,
      balance: Math.round(fresh ? fresh.points : m.points + sale.subtotal),
    };
    send("points-earned", payload);
  });

  useEffect(() => {
    if (!lastSale || announced.current === lastSale.orderNumber) return;
    announced.current = lastSale.orderNumber;
    void announce(lastSale);
  }, [lastSale]);

  const showRecent = !!recent && !member && pending.length === 0;
  if (!pending.length && !notice && !showRecent && !here.length && !tonight) return null;

  return (
    <div className="fixed right-3 top-3 z-40 m-0 flex max-h-[calc(100dvh-1.5rem)] w-[min(23rem,calc(100vw-1.5rem))] flex-col items-end gap-2 overflow-y-auto p-1">
      {notice && (
        <div className="notice notice-success w-full p-2.5 text-xs shadow-lg" role="status">
          {notice}
        </div>
      )}

      {tonight && <TonightTickets tonight={tonight} printing={printing} onPrint={() => void printTonight()} onDismiss={() => setTonight(null)} />}

      {showRecent && recent && (
        <div className="flex w-full items-center gap-2 rounded-lg border-2 bg-[var(--surface)] p-2 text-sm shadow-lg" style={{ borderColor: "var(--foreground)" }}>
          <MemberAvatar name={recent.member.name} url={recent.member.avatar_url} size={32} plus={recent.member.tier === "Insiders+"} />
          <span className="min-w-0 flex-1 truncate">
            <strong>{recent.member.name}</strong> checked in. Not on this order.
          </span>
          <button className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs" onClick={() => onAttach(recent.member)}>
            Attach
          </button>
          <button className="shrink-0 px-1 text-base" style={{ color: "var(--muted)" }} aria-label="Dismiss" onClick={() => setRecent(null)}>
            ×
          </button>
        </div>
      )}

      {pending.length > 0 && collapsed && (
        <button
          className="font-display rounded-full border-2 px-4 py-2 text-sm uppercase tracking-wide shadow-lg"
          style={{ background: "var(--gold)", color: "var(--foreground)", borderColor: "var(--foreground)" }}
          onClick={() => setCollapsed(false)}
        >
          {pending.length} check-in{pending.length === 1 ? "" : "s"} waiting
        </button>
      )}

      {!collapsed &&
        pending.map((p) => (
          <div
            key={p.id}
            className="w-full overflow-hidden rounded-lg border-2 bg-[var(--surface)] text-sm"
            style={{ borderColor: "var(--foreground)", boxShadow: "5px 5px 0 var(--foreground)" }}
          >
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "var(--gold)", color: "var(--foreground)" }}>
              <span className="font-display flex-1 text-xs uppercase tracking-wide">
                {p.kind === "new" || (p.card?.kind === "known" && p.card.fresh) ? "New regular · just signed up" : "Check-in for points"}
              </span>
              <span className="text-[11px]">{ago(Math.max(0, now - p.at))}</span>
              <button className="text-[11px] font-bold underline" onClick={() => setCollapsed(true)}>
                Later
              </button>
            </div>

            <div className="space-y-2 p-3">
              {!p.card && !p.error && <div style={{ color: "var(--muted)" }}>Looking them up…</div>}

              {p.card?.kind === "known" && (
                <KnownCard
                  card={p.card}
                  current={member}
                  hasOrder={hasOrder}
                  working={p.working}
                  onConfirm={(m, addToOrder) => confirm(p, m, p.card?.kind === "known" && p.card.fresh === true, null, addToOrder)}
                  onDecline={() => decline(p)}
                />
              )}

              {p.card?.kind === "new" && (
                <NewCard
                  card={p.card}
                  current={member}
                  hasOrder={hasOrder}
                  working={p.working}
                  onCreate={(addToOrder) => create(p, null, addToOrder)}
                  onAttachExisting={(id) => create(p, id, true)}
                  onCancel={() => decline(p)}
                />
              )}

              {p.error && (
                <>
                  <div className="text-xs" style={{ color: "var(--danger-text)" }}>
                    {p.error}
                  </div>
                  {!p.card && (
                    <div className="flex gap-2">
                      <button className="btn-secondary flex-1 !py-1.5 !text-xs" disabled={p.working} onClick={() => load(p.id, p.ref)}>
                        Retry
                      </button>
                      <button className="btn-secondary flex-1 !py-1.5 !text-xs" disabled={p.working} onClick={() => decline(p)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

      {here.length > 0 && pending.length === 0 && (
        <HereTodayPanel here={here} open={hereOpen} onToggle={() => setHereOpen((o) => !o)} current={member} onAttach={(m) => onAttach(m)} />
      )}
    </div>
  );
}

// "🎟 2 tickets today · Print": online tickets for someone who just checked
// in. Print claims and prints them (one print per ticket, like a scan);
// tickets that already have paper show as printed.
function TonightTickets({
  tonight,
  printing,
  onPrint,
  onDismiss,
}: {
  tonight: { member: PosMember; tickets: DoorTicket[] };
  printing: boolean;
  onPrint: () => void;
  onDismiss: () => void;
}) {
  const toPrint = tonight.tickets.filter((t) => t.printable);
  const count = tonight.tickets.reduce((n, t) => n + t.quantity, 0);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  return (
    <div className="w-full rounded-lg border-2 bg-[var(--surface)] p-2.5 text-sm shadow-lg" style={{ borderColor: "var(--foreground)" }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <strong>
            🎟 {firstNameOf(tonight.member.name)}: {count} ticket{count === 1 ? "" : "s"} today
          </strong>
        </span>
        {toPrint.length > 0 ? (
          <button className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs" disabled={printing} onClick={onPrint}>
            {printing ? "Printing…" : "Print"}
          </button>
        ) : (
          <span className="shrink-0 text-xs font-bold" style={{ color: "var(--muted)" }}>
            Printed
          </span>
        )}
        <button className="shrink-0 px-1 text-base" style={{ color: "var(--muted)" }} aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs" style={{ color: "var(--muted)" }}>
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

// "Here today": everyone checked in this business day, newest first, with
// big faces and names, so staff can greet regulars by name and put someone
// on an order when they buy later.
function HereTodayPanel({ here, open, onToggle, current, onAttach }: { here: HereToday[]; open: boolean; onToggle: () => void; current: PosMember | null; onAttach: (m: PosMember) => void }) {
  return (
    <div className="w-full overflow-hidden rounded-lg border-2 bg-[var(--surface)] text-sm shadow-lg" style={{ borderColor: "var(--foreground)" }}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" style={{ background: "var(--foreground)", color: "var(--gold)" }} onClick={onToggle} aria-expanded={open}>
        <span className="font-display flex-1 text-xs uppercase tracking-wide">Here today · {here.length}</span>
        <span className="flex -space-x-2">
          {here.slice(0, 5).map((h) => (
            <MemberAvatar key={h.member.id} name={h.member.name} url={h.member.avatar_url} size={24} />
          ))}
        </span>
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="max-h-[60dvh] divide-y overflow-y-auto" style={{ borderColor: "var(--border)" }}>
          {here.map((h) => (
            <li key={h.member.id} className="flex items-center gap-3 px-3 py-2.5">
              <MemberAvatar name={h.member.name} url={h.member.avatar_url} size={52} plus={h.member.tier === "Insiders+"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold leading-tight">{h.member.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {new Date(h.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}
                  {h.streak ? ` · day ${h.streak} streak` : ""}
                </div>
                {h.member.tagline && <div className="truncate text-xs italic">“{h.member.tagline}”</div>}
              </div>
              {current?.id === h.member.id ? (
                <span className="shrink-0 text-xs font-bold" style={{ color: "var(--success-text)" }}>
                  On order
                </span>
              ) : (
                <button className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={() => onAttach(h.member)}>
                  Add to order
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Big face and name, so staff can put the two together and greet them by
// name next time. Their own line from their account, if they wrote one.
function Face({ m, phoneLast4 }: { m: PosMember; phoneLast4?: string }) {
  return (
    <div className="flex items-center gap-3">
      <MemberAvatar name={m.name} url={m.avatar_url} size={96} plus={m.tier === "Insiders+"} />
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
        <button className="btn-secondary flex-[3] !py-2" disabled={working} onClick={() => onConfirm(true)}>
          Check in + {hasOrder ? "add to this order" : "next order"}
        </button>
        <button className="btn-secondary flex-[2] !py-2" disabled={working} onClick={onNo}>
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
          <MemberAvatar name={m.name} url={m.avatar_url} size={44} plus={m.tier === "Insiders+"} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{m.name}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {m.tier} · {pts(m.points)}
              {current?.id === m.id ? " · on this order" : ""}
            </div>
          </div>
          <button className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs" disabled={working} onClick={() => onConfirm(m, false)}>
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
      <button className="btn-secondary w-full !py-2" disabled={working} onClick={onDecline}>
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
              <button className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs" disabled={working} onClick={() => onAttachExisting(match.id)}>
                Attach {firstNameOf(match.name)}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 !py-2" disabled={working} onClick={() => onCreate(false)}>
              {working ? "Working…" : "Create new"}
            </button>
            <button className="btn-secondary flex-1 !py-2" disabled={working} onClick={onCancel}>
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
