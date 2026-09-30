"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PRIVATE_CHANNEL, realtimeReady } from "@/lib/supabase/realtime";
import { checkinTopic, formatPhone, isFullPhone, type CheckinConfirmed, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import { createKioskMember, startCheckin } from "./actions";
import PointsCelebration from "./PointsCelebration";
import { badgeCheer, badgeFor, type Badge } from "@/lib/visits";
import type { CheckinTickets, TabletTicket } from "@/lib/door-tickets";
import type { TicketsShown } from "./TicketsCard";
import { isClaimUrl } from "@/lib/claim-link";
import ClaimQr from "./ClaimQr";
import k from "./kiosk.module.css";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

export type CheckinStep =
  | { name: "phone" } // the keypad: always there between check-ins
  | { name: "new" } // a number we don't know: first and last name
  | { name: "sent" } // a known number, sent to the register; back to the keypad shortly
  | { name: "created"; firstName: string; claimUrl: string | null }; // a new account, made

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
}

// Badge banners follow the check-in's one at a time, and go quickly so the
// line keeps moving (a little longer when there's a free popcorn to ask for).
const BADGE_STAGGER_MS = 1100;
const BADGE_MS = 6000;
const BADGE_REWARD_MS = 10_000;

const OFFLINE = "We couldn't reach the register. Ask a staff member for help.";

// Half-finished screens clear themselves when someone walks away.
const TIMEOUT_MS: Record<CheckinStep["name"], number> = { phone: 0, new: 90_000, sent: 2_800, created: 25_000 };

// A request the register hasn't answered is resent until it has, and given
// up after this long (the sealed reference expires then anyway).
const OUTBOX_MS = 15 * 60_000;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

// The check-in half of the customer tablet: always the keypad, built for a
// line at the door, where nobody waits on the bartender.
// - A known number goes to the register as an opaque request and the panel
//   is straight back to the keypad. Staff confirm by photo when they can;
//   that pays the visit points, and a banner says so here.
// - An unknown number asks for a first and last name and makes the account
//   right away (email marketing off), then offers a QR code to finish on
//   their own phone. Staff still confirm the visit on the register.
// This screen never shows anyone's details until staff have confirmed:
// then just a first name and points (and, for a member with no website
// login yet, a QR code in the banner to set one up). When a sale with a
// member on it completes, the register says so and the points burst plays
// here.
// initialStep is for previews only.
// onTickets: someone's online tickets for today, after staff confirm their
// check-in. CustomerDisplay shows them beside the order, clear of the keypad.
export default function CheckinKiosk({
  registerTopic,
  initialStep,
  onTickets,
}: {
  registerTopic: string;
  initialStep?: CheckinStep;
  onTickets?: (shown: TicketsShown) => void;
}) {
  const [step, setStep] = useState<CheckinStep>(initialStep ?? { name: "phone" });
  const [digits, setDigits] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [celebration, setCelebration] = useState<(PointsEarned & { key: number }) | null>(null);
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
    setDigits("");
    setFirstName("");
    setLastName("");
    setError(null);
  }

  function reset() {
    session.current += 1;
    resetForm();
    setStep({ name: "phone" });
  }

  function toast(t: Omit<Toast, "key">, ms = 8_000) {
    const key = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { ...t, key }]);
    // A QR code stays up long enough to get a phone out.
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), t.claimUrl ? 25_000 : ms);
  }

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
    toast({
      title: p.isNew ? `Welcome to the Royale, ${name}!` : `✓ ${name}, you're checked in`,
      detail,
      tone: "ok",
      emoji: null,
      claimUrl: isClaimUrl(p.claimUrl) ? p.claimUrl : null,
    });
    badges.forEach((b, i) => {
      const c = badgeCheer(b, name);
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
    toast({ title: "A check-in couldn't be confirmed", detail: "Please see your bartender.", tone: "warn", emoji: null, claimUrl: null });
  });

  const onPoints = useEffectEvent((p: Partial<PointsEarned> | null) => {
    const earned = Math.round(Number(p?.earned));
    const balance = Math.round(Number(p?.balance));
    if (!p || typeof p.firstName !== "string" || !(earned > 0) || !Number.isFinite(balance)) return;
    setCelebration({ orderNumber: Number(p.orderNumber) || 0, firstName: p.firstName.slice(0, 40), earned, balance: Math.max(0, balance), key: Date.now() });
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

  const timeUp = useEffectEvent(() => reset());

  useEffect(() => {
    const supabase = createClient();
    let channel: Channel | null = null;
    let cancelled = false;

    realtimeReady(supabase).then(() => {
      if (cancelled) return;
      const ch = supabase.channel(checkinTopic(registerTopic), PRIVATE_CHANNEL);
      channel = ch;
      channelRef.current = ch;
      ch.on("broadcast", { event: "checkin-seen" }, (msg) => onSeen(msg.payload?.id))
        .on("broadcast", { event: "checkin-confirmed" }, (msg) => onConfirmed(msg.payload))
        .on("broadcast", { event: "checkin-declined" }, (msg) => onDeclined(msg.payload?.id))
        .on("broadcast", { event: "checkin-tickets" }, (msg) => onTicketsMessage(msg.payload))
        .on("broadcast", { event: "checkin-sync" }, () => resendAll(false))
        .on("broadcast", { event: "points-earned" }, (msg) => onPoints(msg.payload))
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
    const ms = TIMEOUT_MS[step.name];
    if (!ms) return;
    const timer = setTimeout(() => timeUp(), ms);
    return () => clearTimeout(timer);
  }, [step, firstName, lastName]);

  // A number typed and walked away from clears itself.
  useEffect(() => {
    if (step.name !== "phone" || !digits) return;
    const timer = setTimeout(() => resetForm(), 45_000);
    return () => clearTimeout(timer);
  }, [step.name, digits]);

  function queue(request: CheckinRequest) {
    outbox.current.set(request.id, { request, seen: false, at: Date.now() });
    send("checkin-request", request);
  }

  function press(key: string) {
    setError(null);
    if (key === "back") setDigits((d) => d.slice(0, -1));
    else if (key === "clear") setDigits("");
    else setDigits((d) => (d.length < 10 ? d + key : d));
  }

  async function lookUp() {
    if (busy || !isFullPhone(digits)) return;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    const r = await startCheckin(digits).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    if (r.status === "new") return setStep({ name: "new" });
    queue(r.request);
    setDigits("");
    setStep({ name: "sent" });
  }

  async function signUp() {
    if (busy) return;
    if (!firstName.trim()) return setError("Type your first name.");
    if (!lastName.trim()) return setError("Type your last name.");
    const ticket = session.current;
    setBusy(true);
    setError(null);
    const r = await createKioskMember({ phone: digits, firstName, lastName }).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    queue(r.request);
    resetForm();
    if (r.status === "known") return setStep({ name: "sent" });
    setStep({ name: "created", firstName: r.firstName, claimUrl: r.claimUrl });
  }

  const badAreaCode = digits.length === 10 && !isFullPhone(digits);

  return (
    <section className={k.checkin} aria-label="Check in">
      {toasts.length > 0 && (
        <div className={k.toasts} aria-live="polite">
          {toasts.map((t) => (
            <div key={t.key} className={`${k.toast} ${t.tone === "warn" ? k.toastWarn : ""} ${t.tone === "badge" ? k.toastBadge : ""} ${t.claimUrl ? k.toastClaim : ""}`}>
              {t.emoji && (
                <span className={k.badgeEmoji} aria-hidden="true">
                  {t.emoji}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <div className={k.toastTitle}>{t.title}</div>
                <div className={k.toastDetail}>{t.detail}</div>
                {t.claimUrl && <div className={k.toastScan}>Scan to see your points online →</div>}
              </div>
              {t.claimUrl && <ClaimQr url={t.claimUrl} size={104} label="QR code: see your points online" />}
            </div>
          ))}
        </div>
      )}

      {step.name === "phone" && (
        <>
          <div>
            <div className={k.eyebrow}>Check in · earn points</div>
            <h1 className={k.title}>Your phone number</h1>
          </div>
          <div className={k.display} aria-live="polite" aria-label="Phone number">
            {digits ? formatPhone(digits) : <span className={k.placeholder}>(___) ___-____</span>}
          </div>
          <div className={k.keys}>
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`${k.key} ${key === "clear" || key === "back" ? k.keySmall : ""}`}
                disabled={busy}
                onClick={() => press(key)}
                aria-label={key === "back" ? "Delete last digit" : key === "clear" ? "Clear" : key}
              >
                {key === "back" ? "⌫" : key === "clear" ? "Clear" : key}
              </button>
            ))}
          </div>
          {(error || badAreaCode) && <p className={k.error}>{error ?? "Start with your area code."}</p>}
          <button className={k.cta} disabled={busy || !isFullPhone(digits)} onClick={lookUp}>
            {busy ? "One moment…" : "Check in →"}
          </button>
          <p className={k.foot}>New here? Same keypad. It takes ten seconds.</p>
        </>
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
            <h1 className={k.title}>What&apos;s your name?</h1>
            <p className={k.sub} style={{ marginTop: 8 }}>
              {formatPhone(digits)} is new to us. Free to join, and every visit earns points.
            </p>
          </div>
          <label className={k.field}>
            <span className={k.fieldLabel}>First name</span>
            <input
              className={k.input}
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
              className={k.input}
              autoComplete="family-name"
              autoCapitalize="words"
              enterKeyHint="done"
              maxLength={40}
              value={lastName}
              onChange={(e) => {
                setError(null);
                setLastName(e.target.value);
              }}
            />
          </label>
          {error && <p className={k.error}>{error}</p>}
          <button type="submit" className={k.cta} disabled={busy || !firstName.trim() || !lastName.trim()}>
            {busy ? "One moment…" : "Create my account →"}
          </button>
          <button type="button" className={k.ghost} disabled={busy} onClick={reset}>
            Start over
          </button>
        </form>
      )}

      {step.name === "sent" && (
        <div className={k.done}>
          <div className={k.check} aria-hidden="true">
            ✓
          </div>
          <h1 className={k.title}>Thanks!</h1>
          <p className={k.sub} style={{ fontSize: 20 }}>
            Your bartender will confirm you in a moment.
          </p>
        </div>
      )}

      {step.name === "created" && (
        <div className={k.done}>
          <div className={k.eyebrow}>You&apos;re in</div>
          <h1 className={k.title}>Welcome, {step.firstName}!</h1>
          <p className={k.sub} style={{ fontSize: 18 }}>
            Your bartender will confirm your first visit and your points will land.
          </p>
          {step.claimUrl && <ClaimQrSlot url={step.claimUrl} />}
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
          onDone={() => setCelebration(null)}
        />
      )}
    </section>
  );
}

// The "finish on your phone" QR code for an account just made here: a
// 30-minute claim link from createKioskMember (lib/member-claim.ts). With no
// link (say the member_claims migration isn't applied yet), the screen is
// the plain welcome.
function ClaimQrSlot({ url }: { url: string }) {
  if (!isClaimUrl(url)) return null;
  return (
    <div className={k.claim}>
      <ClaimQr url={url} size={188} label="QR code: finish your account on your phone" />
      <div className={k.claimCopy}>
        <div className={k.claimTitle}>Scan to finish your account on your phone</div>
        <p className={k.sub}>Add a login to see your points and visits. No need to hold up the line.</p>
      </div>
    </div>
  );
}

