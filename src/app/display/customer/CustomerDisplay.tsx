"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { RegisterCartSnapshot } from "@/lib/registerChannel";
import type { PlusFinish } from "@/lib/checkin";
import { BADGES, VISIT_POINTS, type BadgeKey } from "@/lib/visits";
import TicketsCard, { type TicketsShown } from "./TicketsCard";
import CheckinKiosk, { type CheckinStep, type Encore } from "./CheckinKiosk";
import FinishCard, { finishShown, type FinishShown } from "./FinishCard";
import Streamers, { makeStreamers, type StreamerPiece } from "./Streamers";
import Rickroll from "./Rickroll";
import { AccountPanel, MemberActions, MemberCard, NeedsCardCard, PlusWelcomeCard, needsCard, type TabletMember } from "./MemberCards";
import StaffSetupView, { parseSetup, type ShownSetup } from "./StaffSetupView";
import PayOnReader from "./PayOnReader";
import CardOnFileAsk from "./CardOnFileAsk";
import { parseCardOnFileAsk, parseReaderPrompt, parseTabletSound, type CardOnFileAsk as CofAsk, type MemberOff, type ReaderPrompt, type RickrollState, type StaffSetup } from "@/lib/registerChannel";
import { cartSound, playSound, setSoundSettings, unlockSound } from "./sounds";
import AutoUpdate from "../AutoUpdate";
import { isGuestName } from "@/lib/member-name";
import k from "./kiosk.module.css";

export interface PromoMovie {
  title: string;
  posterUrl: string | null;
  nextShowtime: string;
}

// "You're all set" stays this long; a setup nothing more is heard about
// (the register closed mid-way) goes after this.
const SETUP_DONE_MS = 4_500;
const SETUP_STALE_MS = 4 * 60_000;

// The red "add your card" card, untouched, gives way to their own card
// after this; brought back from the chip on their card, after this.
const RED_MS = 10_000;
const RED_AGAIN_MS = 20_000;

// "Approved" on the card reader screen stays this long. A "paid" this soon
// after it plays no second sound.
const APPROVED_MS = 3_500;
const APPROVED_QUIET_MS = 20_000;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function showtime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// The tablet facing the customer at the bar. Two halves:
// - left, always: the check-in keypad (CheckinKiosk.tsx), because everyone
//   checks in when they come through the door;
// - right: the live order as the bartender rings it up (PosApp.tsx
//   broadcasts cart snapshots; nothing is saved until the sale), or,
//   between orders, a Royale welcome: tonight's movies and what checking in
//   earns (points and badges, lib/visits.ts). A member on the order with
//   nothing rung up yet sees their own card (photo, profile line, badges,
//   points, what's left to make it theirs); once something's rung up, their
//   account sits at the foot of the order. A paying Insiders+ member gets
//   the gold badge; a former unlimited member with nothing paying for it,
//   or Insiders+ with no card on file, gets a red "add your card" card
//   (MemberCards.tsx). It never locks the screen: "✕ Show my card", or ten
//   seconds untouched, puts it down for their own card, and a chip on that
//   brings it back.
// The register's ✨ Celebrate throws streamers across the whole screen, and
// so does Rewind (Back office found a regular's visits from before the new
// system), under the kiosk's "Welcome back".
// Their card (or their account) stays up the whole time they're on the
// order, with "Done" and "That's not me" under it: either takes them off the
// order and the screen goes back to normal (MemberCards.tsx MemberActions).
// When staff set up a guest's account on the register for them, the whole
// screen follows along as it's typed (StaffSetupView.tsx).
// While a card payment waits on the card reader, the whole screen says
// "Finish on the card reader" (PayOnReader.tsx), then "Approved" once the
// register hears the card went through.
// previewCart / previewStep / previewTickets / previewFinish / previewSetup
// are for previews only.
export default function CustomerDisplay({
  movies,
  registerTopic,
  version,
  previewCart,
  previewStep,
  previewTickets,
  previewFinish,
  previewSetup,
}: {
  movies: PromoMovie[];
  registerTopic: string;
  version?: string; // this deployment, so the screen can update itself
  previewCart?: RegisterCartSnapshot;
  previewStep?: CheckinStep;
  previewTickets?: TicketsShown;
  previewFinish?: PlusFinish;
  previewSetup?: ShownSetup;
}) {
  const [cart, setCart] = useState<RegisterCartSnapshot | null>(previewCart ?? null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const toRegister = useCallback((event: string, payload: object) => {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);

  // Staff setting up this guest's account on the register, as it's typed:
  // up until it's saved ("You're all set" for a moment) or cancelled. One
  // left behind (the register closed mid-way) goes after a few minutes.
  const [setup, setSetup] = useState<ShownSetup | null>(previewSetup ?? null);
  useEffect(() => {
    if (!setup) return;
    const timer = setTimeout(() => setSetup(null), setup.stage === "saved" ? SETUP_DONE_MS : SETUP_STALE_MS);
    return () => clearTimeout(timer);
  }, [setup]);
  const onSetup = useCallback((p: Partial<StaffSetup> | null) => {
    const next = parseSetup(p);
    if (!next) return;
    setSetup((was) => {
      const same = was?.id === next.id;
      // "Saved" for a setup this screen never saw (it was reloading): still "You're all set".
      if (next.stage === "saved") return { ...(same && was ? was : next), stage: "saved", sent: false };
      // The guest's "✓ That's right" holds until what's typed changes.
      const unchanged = same && was && was.phone === next.phone && was.name === next.name && was.email === next.email && !next.hold;
      return { ...next, sent: !!unchanged && !!was?.sent };
    });
  }, []);
  const onSetupEnd = useCallback((id: unknown) => {
    setSetup((was) => (was && was.id === id && was.stage === "typing" ? null : was));
  }, []);
  const setupOk = useCallback(() => {
    if (!setup || setup.stage !== "typing" || !setup.ready) return;
    toRegister("staff-setup-ok", { id: setup.id });
    setSetup({ ...setup, sent: true });
  }, [setup, toRegister]);
  // Their "✓ That's right" didn't save (nothing came back): it can be tapped again.
  useEffect(() => {
    if (!setup?.sent) return;
    const timer = setTimeout(() => setSetup((s) => (s && s.sent ? { ...s, sent: false } : s)), 10_000);
    return () => clearTimeout(timer);
  }, [setup]);

  // "Charge card on file": the guest's yes (CardOnFileAsk.tsx). Seen is said
  // at once, so the register knows this screen is up; one left behind (the
  // register closed mid-way) goes after a few minutes.
  const [cof, setCof] = useState<CofAsk | null>(null);
  const onCofAsk = useCallback(
    (p: unknown) => {
      const ask = parseCardOnFileAsk(p);
      if (!ask) return;
      toRegister("cof-seen", { id: ask.id });
      setCof((was) => (was?.id === ask.id ? was : ask));
    },
    [toRegister],
  );
  const onCofEnd = useCallback((id: unknown) => setCof((was) => (was && was.id === id ? null : was)), []);
  useEffect(() => {
    if (!cof) return;
    const timer = setTimeout(() => setCof(null), 5 * 60_000);
    return () => clearTimeout(timer);
  }, [cof]);
  const cofAnswer = useCallback(
    (yes: boolean, tipCents: number) => {
      if (!cof) return;
      toRegister("cof-answer", { id: cof.id, yes, tipCents });
      if (!yes) setCof(null);
    },
    [cof, toRegister],
  );

  // "Done" or "That's not me" under their card: hidden at once (by the first
  // name the screen shows) while the register takes them off the order. If
  // it doesn't (it had moved on), the card comes back.
  const [offFor, setOffFor] = useState<string | null>(null);
  const [home, setHome] = useState(0);
  useEffect(() => {
    if (!offFor) return;
    const timer = setTimeout(() => setOffFor(null), 6_000);
    return () => clearTimeout(timer);
  }, [offFor]);
  const memberOff = useCallback(
    (firstName: string, why: MemberOff["why"]) => {
      const off: MemberOff = { firstName, why };
      toRegister("member-off", off);
      setOffFor(firstName);
      setHome((n) => n + 1);
    },
    [toRegister],
  );
  const [burst, setBurst] = useState<{ id: number; pieces: StreamerPiece[]; banner?: string | null } | null>(null);
  // The Rickroll (Rickroll.tsx), while it's up. The register's button
  // changes only on what this screen tells it: whenever it goes up or comes
  // down (it ended by itself, or someone tapped ✕), and in answer to every
  // "rickroll" or "rickroll-stop", even one that changes nothing.
  const [rickroll, setRickroll] = useState<number | null>(null);
  const [rickrollAsked, setRickrollAsked] = useState(0);
  const rickrollOn = rickroll !== null;
  useEffect(() => {
    const state: RickrollState = { playing: rickrollOn };
    toRegister("rickroll-state", state);
  }, [rickrollOn, rickrollAsked, toRegister]);
  // Online tickets for whoever just checked in, beside the order for a bit.
  const [tickets, setTickets] = useState<TicketsShown | null>(previewTickets ?? null);
  useEffect(() => {
    if (!tickets) return;
    const timer = setTimeout(() => setTickets(null), 25_000);
    return () => clearTimeout(timer);
  }, [tickets]);
  // A former unlimited member's "add your card on your phone" QR code, from
  // the register: up until they've paid, staff take it down, or 2 minutes.
  const [finish, setFinish] = useState<FinishShown | null>(() => finishShown(previewFinish));
  useEffect(() => {
    if (!finish) return;
    const timer = setTimeout(() => setFinish(null), 120_000);
    return () => clearTimeout(timer);
  }, [finish]);

  // A former unlimited member with nothing paying for it, or Insiders+ with
  // no card on file, keeps a red "add your card" card up beside the order
  // (MemberCards.tsx) until it's set up or they're off the order. Once it's
  // set up, a short "You're Insiders+!" takes its place: `welcome` while
  // that shows, and `setUp` (their first name) keeps the red card down
  // until the register catches up (staff tap Done after the welcome has
  // already played here).
  const [welcome, setWelcome] = useState<{ key: number; firstName: string; renewed: boolean } | null>(null);
  const [setUp, setSetUp] = useState<string | null>(null);
  useEffect(() => {
    if (!welcome) return;
    const timer = setTimeout(() => setWelcome(null), 9_000);
    return () => clearTimeout(timer);
  }, [welcome]);
  // The red card can always be put down (Andrew 10/3): "✕ Show my card",
  // or RED_MS untouched. `redDown`: the first name it's down for, until
  // they're off the order or tap "Add a card" on their card (`redAgain`:
  // up again, for RED_AGAIN_MS). This screen only: the register keeps its
  // red signal, and a card setup on the reader carries on (once it goes
  // through, the welcome plays as ever). `encore`: their entrance again as
  // they tap "Show my card".
  const [redDown, setRedDown] = useState<string | null>(null);
  const [redAgain, setRedAgain] = useState<{ firstName: string; key: number } | null>(null);
  const [encore, setEncore] = useState<Encore | null>(null);
  const putDown = useCallback((m: TabletMember, withCard: boolean) => {
    setRedDown(m.firstName);
    const entrance = m.profile?.entrance ?? null;
    if (withCard && entrance && entrance !== "classic") setEncore({ key: Date.now(), entrance, color: m.profile?.color ?? null });
    else playSound("card");
  }, []);
  const bringBack = useCallback((firstName: string) => {
    setRedDown(null);
    setRedAgain({ firstName, key: Date.now() });
    playSound("card");
  }, []);
  const lastMember = useRef<RegisterCartSnapshot["member"]>(previewCart?.member ?? null);
  // The last cart, so each new one can make its sound (sounds.ts cartSound).
  const lastCart = useRef<RegisterCartSnapshot | null>(previewCart ?? null);

  // "Approved" on the card reader screen, for a moment: the register heard
  // the card go through ("card-approved") while that screen was up. The
  // "approved" sound plays then, so the "paid" after it (once the sale is
  // saved) stays quiet. Any other sale's "paid" plays it as ever.
  const [approved, setApproved] = useState<{ key: number; prompt: ReaderPrompt; cart: RegisterCartSnapshot } | null>(null);
  const approvedAt = useRef(0);
  useEffect(() => {
    if (!approved) return;
    const timer = setTimeout(() => setApproved(null), APPROVED_MS);
    return () => clearTimeout(timer);
  }, [approved]);
  const onCardApproved = useCallback(() => {
    const was = lastCart.current;
    const prompt = onReader(was);
    if (!was || !prompt) return;
    approvedAt.current = Date.now();
    setApproved({ key: approvedAt.current, prompt, cart: was });
    playSound("approved");
  }, []);
  const onPaid = useCallback(() => {
    if (Date.now() - approvedAt.current > APPROVED_QUIET_MS) playSound("approved");
  }, []);
  const celebrated = useRef<string | null>(null);
  const celebrate = useCallback((firstName: string, renewed: boolean) => {
    celebrated.current = firstName;
    setSetUp(firstName);
    setWelcome({ key: Date.now(), firstName, renewed });
  }, []);

  // Every cart from the register. Set up on the register while this screen
  // missed the welcome (it was reloading, say): celebrate now instead.
  const onCart = useCallback(
    (next: RegisterCartSnapshot) => {
      const before = lastMember.current ?? null;
      const now = next.member ?? null;
      lastMember.current = now;
      const sound = cartSound(lastCart.current, next);
      lastCart.current = next;
      if (sound) playSound(...sound);
      setCart(next);
      // Someone they said "Done" or "That's not me" for is off the order.
      setOffFor((off) => (off && now?.firstName === off ? off : null));
      // A red card put down stays down only while they're on the order.
      setRedDown((d) => (d && now?.firstName === d ? d : null));
      setRedAgain((a) => (a && now?.firstName === a.firstName ? a : null));
      const justSetUp = needsCard(before) && !!now && !needsCard(now) && now.plus && now.firstName === before?.firstName;
      if (justSetUp && celebrated.current !== now.firstName) celebrate(now.firstName, !!before?.noCard);
      if (!needsCard(now)) setSetUp(null);
      // Celebrated once per member on the order.
      if (!now || now.firstName !== celebrated.current) celebrated.current = null;
    },
    [celebrate],
  );

  // "You're Insiders+!" from the register (CheckinKiosk hears it). For the
  // member on this order it plays here, beside the order, instead of as a
  // banner over the keypad: true when it did (or already has).
  const onPlusWelcome = useCallback(
    (firstName: string) => {
      const who = lastMember.current;
      if (!who || who.firstName.slice(0, 40) !== firstName) return false;
      if (celebrated.current !== who.firstName) celebrate(who.firstName, !!who.noCard);
      return true;
    },
    [celebrate],
  );

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(registerTopic)
        .on("broadcast", { event: "cart" }, (msg) => onCart(msg.payload as RegisterCartSnapshot))
        .on("broadcast", { event: "staff-setup" }, (msg) => onSetup(msg.payload))
        .on("broadcast", { event: "staff-setup-end" }, (msg) => onSetupEnd(msg.payload?.id))
        .on("broadcast", { event: "celebrate" }, () => setBurst({ id: Date.now(), pieces: makeStreamers() }))
        // { play: true }: up (already up, it stays). A register from before
        // the answers sent it bare, to turn it on or off.
        .on("broadcast", { event: "rickroll" }, (msg) => {
          const play = msg.payload?.play === true;
          setRickroll((on) => (play ? (on ?? Date.now()) : on ? null : Date.now()));
          setRickrollAsked((n) => n + 1);
        })
        .on("broadcast", { event: "rickroll-stop" }, () => {
          setRickroll(null);
          setRickrollAsked((n) => n + 1);
        })
        // Sound on/off and volume from the register's Devices (remembered
        // here), a sample at that level, and a sale that went through.
        .on("broadcast", { event: "sound" }, (msg) => {
          const s = parseTabletSound(msg.payload);
          if (s) setSoundSettings(s);
        })
        .on("broadcast", { event: "sound-test" }, () => playSound("approved"))
        .on("broadcast", { event: "card-approved" }, () => onCardApproved())
        .on("broadcast", { event: "cof-ask" }, (msg) => onCofAsk(msg.payload))
        .on("broadcast", { event: "cof-end" }, (msg) => onCofEnd(msg.payload?.id))
        .on("broadcast", { event: "paid" }, () => onPaid())
        .subscribe((status) => {
          // A screen that just loaded (or refreshed) has missed every prior
          // broadcast: ask the register to resend its current state.
          if (status === "SUBSCRIBED") channel?.send({ type: "broadcast", event: "request-state", payload: {} });
        });
      channelRef.current = channel;
    });

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [registerTopic, onCart, onSetup, onSetupEnd, onCardApproved, onPaid, onCofAsk, onCofEnd]);

  // Browsers keep sound off until the page is tapped: the first tap on the
  // tablet turns it on, and any later one wakes it if the iPad let it sleep.
  useEffect(() => {
    const wake = () => unlockSound();
    const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, wake, { capture: true, passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, wake, { capture: true }));
  }, []);

  // The moments on this side of the screen, each with its sound.
  const setupKey = setup ? `${setup.id}:${setup.stage}` : null;
  useEffect(() => {
    if (setupKey) playSound(setupKey.endsWith(":saved") ? "chime" : "card");
  }, [setupKey]);
  const burstId = burst?.id ?? null;
  useEffect(() => {
    if (burstId) playSound("confetti");
  }, [burstId]);
  const rickrollWas = useRef(false);
  useEffect(() => {
    // A tape in as it starts (before the video's own sound), and winding
    // down once it's gone: never over the song.
    if (rickrollOn !== rickrollWas.current) playSound(rickrollOn ? "tapeIn" : "tapeOut");
    rickrollWas.current = rickrollOn;
  }, [rickrollOn]);
  const welcomeKey = welcome?.key ?? null;
  useEffect(() => {
    if (welcomeKey) playSound("fanfare");
  }, [welcomeKey]);
  const ticketsKey = tickets?.key ?? null;
  const finishKey = finish?.key ?? null;
  useEffect(() => {
    if (ticketsKey || finishKey) playSound("card");
  }, [ticketsKey, finishKey]);

  const hasOrder = !!cart && cart.items.length > 0;
  // "Finish on the card reader", with a soft chime as it comes up.
  const readerPrompt = onReader(cart);
  const onReaderNow = !!readerPrompt;
  useEffect(() => {
    if (onReaderNow) playSound("chime");
  }, [onReaderNow]);
  const clearBurst = useCallback(() => setBurst(null), []);
  const clearRickroll = useCallback(() => setRickroll(null), []);
  const rewindStreamers = useCallback(() => setBurst({ id: Date.now(), pieces: makeStreamers(90), banner: null }), []);

  // The red card, by first name: not while their "add your card on your
  // phone" QR code is up (that card asks the same thing, with the code), or
  // once it's set up. With nothing rung up yet (and no tickets beside it),
  // it, or the welcome, fills the panel, with their account under it;
  // otherwise it's a banner over the order, which keeps its total in view.
  // Anyone else on the order with nothing rung up yet sees their card
  // (MemberCard); once something's rung up, their account sits at the foot
  // of the order.
  // Not someone who just said "Done" or "That's not me" (offFor).
  const who = cart?.member && cart.member.firstName !== offFor ? cart.member : null;
  // Put down (redDown): their own card instead, with a chip to bring it back.
  const owes = !!who && needsCard(who) && who.firstName !== setUp && !welcome;
  const cardFor = owes && who.firstName !== redDown && !finish ? who : null;
  const addCard = owes && who.firstName === redDown ? () => bringBack(who.firstName) : undefined;
  const cardKind = who?.unlimited ? "unlimited" : "nocard";
  // Untouched, it gives way to their card by itself (the red's been seen).
  const redUp = cardFor?.firstName ?? null;
  const redLong = !!redUp && redAgain?.firstName === redUp;
  const redAgainKey = redAgain?.key ?? 0;
  useEffect(() => {
    if (!redUp) return;
    const timer = setTimeout(
      () => {
        setRedDown(redUp);
        playSound("card");
      },
      redLong ? RED_AGAIN_MS : RED_MS,
    );
    return () => clearTimeout(timer);
  }, [redUp, redLong, redAgainKey]);
  const hero = !hasOrder && !tickets;
  // "You're all set, Sarah!": the name staff typed, or the one on the order.
  const greet = setup?.name ? setup.name.split(" ")[0] : who && !isGuestName(who.firstName) ? who.firstName : null;

  return (
    <div className={k.screen}>
      <CheckinKiosk
        registerTopic={registerTopic}
        home={home}
        initialStep={previewStep}
        onTickets={setTickets}
        onRewind={rewindStreamers}
        onFinish={setFinish}
        onPlusWelcome={onPlusWelcome}
        encore={encore}
      />
      <aside className={`${k.side} ${!hero && (cardFor || welcome) ? k.sideTight : ""} ${who && !hasOrder ? k.sideCard : ""}`}>
        {finish && <FinishCard key={finish.key} shown={finish} />}
        {welcome && !hero && <PlusWelcomeCard key={welcome.key} firstName={welcome.firstName} renewed={welcome.renewed} hero={false} />}
        {cardFor && !hero && <NeedsCardCard firstName={cardFor.firstName} kind={cardKind} hero={false} onDismiss={() => putDown(cardFor, false)} />}
        {tickets && <TicketsCard key={tickets.key} shown={tickets} />}
        {hasOrder ? (
          <OrderReceipt
            cart={who ? cart : { ...cart, member: null }}
            onNotMe={who ? () => memberOff(who.firstName, "not-me") : undefined}
            onAddCard={finish ? undefined : addCard}
          />
        ) : welcome && hero ? (
          <PlusWelcomeCard key={welcome.key} firstName={welcome.firstName} renewed={welcome.renewed} hero />
        ) : cardFor && hero ? (
          <>
            <NeedsCardCard firstName={cardFor.firstName} kind={cardKind} hero onDismiss={() => putDown(cardFor, true)} />
            <AccountPanel member={cardFor} alone />
            <MemberActions onOff={(why) => memberOff(cardFor.firstName, why)} />
          </>
        ) : who && hero && !finish ? (
          <>
            <MemberCard member={who} onAddCard={addCard} />
            <MemberActions onOff={(why) => memberOff(who.firstName, why)} />
          </>
        ) : who ? (
          <>
            <AccountPanel member={who} alone onAddCard={finish ? undefined : addCard} />
            <MemberActions onOff={(why) => memberOff(who.firstName, why)} />
          </>
        ) : (
          <Welcome movies={movies} />
        )}
      </aside>
      {approved ? (
        <PayOnReader key={approved.key} prompt={approved.prompt} cart={approved.cart} approved />
      ) : (
        readerPrompt && <PayOnReader prompt={readerPrompt} cart={cart} />
      )}
      {setup && <StaffSetupView setup={setup} greet={greet} onOk={setupOk} />}
      {cof && <CardOnFileAsk key={cof.id} ask={cof} onAnswer={cofAnswer} />}
      {burst && <Streamers key={burst.id} pieces={burst.pieces} banner={burst.banner} onDone={clearBurst} />}
      {rickroll && <Rickroll key={rickroll} onDone={clearRickroll} />}
      {version && (
        <AutoUpdate current={version} busy={hasOrder || !!who || !!setup || !!tickets || !!finish || !!burst || !!rickroll || !!cardFor || !!welcome || !!approved} />
      )}
    </div>
  );
}

// The card reader's turn: the payment screen is up with something on the
// order, and the register says the payment is on the reader. Null for
// cash, a voucher, or before it reaches the reader.
function onReader(cart: RegisterCartSnapshot | null): ReaderPrompt | null {
  if (!cart?.paying || cart.items.length === 0) return null;
  return parseReaderPrompt(cart.reader);
}

// Between orders: Royale Cinema, tonight's movies, and why checking in pays.
function Welcome({ movies }: { movies: PromoMovie[] }) {
  return (
    <>
      <Image src="/photos/logo.png" alt="Royale Cinema Lounge" width={1436} height={492} className={k.logo} priority />
      <div className={k.sprockets} aria-hidden="true" />
      {movies.length > 0 && (
        <section>
          <div className={k.sectionHead}>
            <h2 className={k.h2}>Now showing</h2>
            <span className={k.eyebrow}>Tickets at the bar</span>
          </div>
          <div className={k.posters} style={{ marginTop: 12 }}>
            {movies.slice(0, 4).map((m) => (
              <div key={m.title} className={k.poster}>
                <div className={k.posterImg}>
                  {m.posterUrl ? (
                    <Image src={m.posterUrl} alt={`${m.title} poster`} fill sizes="220px" className="object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center p-3 text-center text-sm font-bold">{m.title}</div>
                  )}
                </div>
                <div className={k.posterTitle}>{m.title}</div>
                <span className={k.timeChip}>{showtime(m.nextShowtime)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <BadgePitch />
    </>
  );
}

// The badges on the welcome pitch, in this order (there are a few more).
const PITCH: BadgeKey[] = ["welcome", "weeks_4", "weeks_13", "weeks_26", "weeks_52", "early_riser", "night_owl", "visits_10"];

// Why checking in pays: points every time, and badges for coming back.
function BadgePitch() {
  const badges = PITCH.flatMap((key) => BADGES.filter((b) => b.key === key));
  return (
    <section className={k.pitch}>
      <div className={k.pitchTitle}>
        {VISIT_POINTS} points every check-in.
        <span className={k.pitchMore}>Come every week for bonuses.</span>
      </div>
      <ul className={k.badgeRow}>
        {badges.map((b) => (
          <li key={b.key} className={k.badgeChip}>
            <span className={k.chipEmoji} aria-hidden="true">
              {b.emoji}
            </span>
            <span className={k.chipLabel}>{b.label}</span>
            <span className={k.chipWhat}>{b.reward ? `+ free ${b.reward}` : `+${b.points}`}</span>
          </li>
        ))}
        {BADGES.length > badges.length && (
          <li className={k.chipMore} aria-label="and more">
            …
          </li>
        )}
      </ul>
    </section>
  );
}

// The live tally on a cream receipt: every line with its price as it's
// rung up, any savings, the total, and (once they've checked in) whose order
// it is, their account (where they stand, points and perks) and the points
// it earns.
// onNotMe: "That's not me" on their account, in case it isn't theirs.
// onAddCard: their red "add your card" banner is down; the chip on their
// account brings it back.
export function OrderReceipt({ cart, onNotMe, onAddCard }: { cart: RegisterCartSnapshot; onNotMe?: () => void; onAddCard?: () => void }) {
  const who = cart.member;
  const earn = cart.pointsToEarn ?? 0;
  const count = cart.items.reduce((n, i) => n + i.quantity, 0);
  // Where they stand (the gold Insiders+ badge for a paying member) is in
  // their account at the foot, so the head stays one line and the order
  // keeps the room; their perks at work are among the savings.
  return (
    <div className={k.receipt}>
      <div className={k.receiptHead}>
        <span className={k.receiptWho}>
          <span className={k.receiptName}>{who && !isGuestName(who.firstName) ? `${who.firstName}'s order` : cart.orderName || "Your order"}</span>
        </span>
        <span className={`${k.eyebrow} ${k.receiptCount}`} style={{ color: "var(--gold)" }}>
          {count} item{count === 1 ? "" : "s"}
        </span>
      </div>
      <ul className={k.lines}>
        {cart.items.map((item, i) => (
          <li key={i} className={k.line}>
            <div style={{ minWidth: 0 }}>
              <div className={k.lineName}>
                {item.quantity > 1 && <span className={k.lineQty}>{item.quantity}×</span>}
                {item.name}
              </div>
              {item.modifiers.length > 0 && <div className={k.lineMods}>{item.modifiers.join(", ")}</div>}
            </div>
            {typeof item.lineTotal === "number" && <div className={k.linePrice}>{money(item.lineTotal)}</div>}
          </li>
        ))}
      </ul>
      <div className={k.totals}>
        <div className={k.totalRow}>
          <span>Subtotal</span>
          <span style={{ fontFamily: "var(--mono)" }}>{money(cart.subtotal)}</span>
        </div>
        {(cart.discounts ?? []).map((d) => (
          <div key={d.label} className={`${k.totalRow} ${k.saving}`}>
            <span>{d.label}</span>
            <span style={{ fontFamily: "var(--mono)" }}>−{money(d.amount)}</span>
          </div>
        ))}
        <div className={k.totalRow} style={{ color: "#6b6455" }}>
          <span>{cart.taxIncluded ? "Tax (included in prices)" : "Tax"}</span>
          <span style={{ fontFamily: "var(--mono)" }}>{money(cart.tax)}</span>
        </div>
        <div className={k.grand}>
          <span className={k.grandLabel}>Total</span>
          <span className={k.grandAmount}>{money(cart.total)}</span>
        </div>
        {cart.paying && cart.readerWaking && (
          <div className={k.totalRow} style={{ color: "#6b6455", justifyContent: "center" }} role="status">
            Card reader is waking up, one moment
          </div>
        )}
      </div>
      {who ? (
        <AccountPanel member={who} earn={earn} onNotMe={onNotMe} onAddCard={onAddCard} />
      ) : (
        earn > 0 && (
          <div className={k.earn}>
            <span>Check in on the left to earn points on this order.</span>
            <span className={k.earnBig}>+{earn}</span>
          </div>
        )
      )}
    </div>
  );
}
