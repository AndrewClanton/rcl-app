"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkinTopic, formatPhone, isFullPhone, type CheckinConfirmed, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import { startCheckin, startNewCheckin } from "./actions";
import PointsCelebration from "./PointsCelebration";
import StreakPath from "./StreakPath";
import { REWARD_LABEL } from "@/lib/visits";
import styles from "./checkin.module.css";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

type Step =
  | { name: "closed" }
  | { name: "phone" }
  | { name: "new" }
  | { name: "waiting"; request: CheckinRequest; seen: boolean }
  | { name: "welcome"; firstName: string; points: number; isNew: boolean; visit?: CheckinConfirmed["visit"] }
  | { name: "help" };

const OFFLINE = "We couldn't reach the register. Ask a staff member for help.";

// Unfinished check-ins close themselves when someone walks away; results
// clear after a few seconds. Waiting gives up quietly after a few minutes --
// the register keeps the request, and if staff confirm it later the welcome
// still shows here.
const TIMEOUT_MS: Record<Step["name"], number> = { closed: 0, phone: 60_000, new: 90_000, waiting: 3 * 60_000, welcome: 14_000, help: 9_000 };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

function pts(n: number) {
  return `${n.toLocaleString("en-US")} point${n === 1 ? "" : "s"}`;
}

// "Check in for points" on the customer screen. The customer types their
// phone number; the register gets an opaque request and shows staff who it
// is (photo, full name, last four of the phone) to Attach or say Not them.
// A number we don't know asks for a first name (email optional, email
// opt-in unticked) and staff Create & attach at the register. This screen
// never sees anyone's details: after staff confirm, it gets a first name and
// a points balance. When a sale with a member on it completes, the register
// says so and the points burst plays here.
export default function CheckinKiosk({ registerTopic }: { registerTopic: string }) {
  const [step, setStep] = useState<Step>({ name: "closed" });
  const [digits, setDigits] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [celebration, setCelebration] = useState<(PointsEarned & { key: number }) | null>(null);
  // Anyone at the kiosk can type numbers, so five lookups in a row that
  // don't end in a check-in staff confirmed lock the keypad for a minute.
  // (The server caps lookups too.)
  const misses = useRef(0);
  const [locked, setLocked] = useState(false);
  const channelRef = useRef<Channel | null>(null);
  // Bumped on close, so a lookup still in flight when the customer walks
  // away doesn't pop the panel back open.
  const session = useRef(0);

  function send(event: string, payload: object) {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }

  function resetForm() {
    setDigits("");
    setFirstName("");
    setEmail("");
    setEmailOptIn(false);
    setError(null);
  }

  function close(cancel: boolean) {
    // The customer backed out: take the card off the register too.
    if (cancel && step.name === "waiting") send("checkin-cancel", { id: step.request.id });
    session.current += 1;
    resetForm();
    setStep({ name: "closed" });
  }

  const onSeen = useEffectEvent((id: unknown) => {
    setStep((s) => (s.name === "waiting" && s.request.id === id && !s.seen ? { ...s, seen: true } : s));
  });

  const onConfirmed = useEffectEvent((p: Partial<CheckinConfirmed> | null) => {
    if (!p || typeof p.id !== "string" || typeof p.firstName !== "string") return;
    // Our own request -- or, after this screen reloaded mid-wait, one it lost
    // track of. Never on top of someone else's check-in in progress.
    const mine = step.name === "waiting" && step.request.id === p.id;
    if (!mine && step.name !== "closed") return;
    misses.current = 0;
    setLocked(false);
    resetForm();
    const v = p.visit;
    const visit =
      v && Number.isFinite(Number(v.streak)) ? { earned: Math.max(0, Math.round(Number(v.earned) || 0)), streak: Math.max(1, Math.round(Number(v.streak))), alreadyToday: v.alreadyToday === true, reward: v.reward === "popcorn" || v.reward === "pizza" ? v.reward : null } : undefined;
    setStep({ name: "welcome", firstName: p.firstName.slice(0, 40), points: Math.max(0, Math.round(Number(p.points) || 0)), isNew: p.isNew === true, visit });
  });

  const onDeclined = useEffectEvent((id: unknown) => {
    if (step.name === "waiting" && step.request.id === id) setStep({ name: "help" });
  });

  const onPoints = useEffectEvent((p: Partial<PointsEarned> | null) => {
    const earned = Math.round(Number(p?.earned));
    const balance = Math.round(Number(p?.balance));
    if (!p || typeof p.firstName !== "string" || !(earned > 0) || !Number.isFinite(balance)) return;
    setCelebration({ orderNumber: Number(p.orderNumber) || 0, firstName: p.firstName.slice(0, 40), earned, balance: Math.max(0, balance), key: Date.now() });
    // The sale's done: whatever the check-in panel was saying is over.
    if (step.name === "welcome" || step.name === "help" || step.name === "waiting") {
      resetForm();
      setStep({ name: "closed" });
    }
  });

  // Joined, back after a dropped connection, or a register (re)joined:
  // either way the register may have missed the request, so send it again.
  const resend = useEffectEvent(() => {
    if (step.name === "waiting") send("checkin-request", step.request);
  });

  const timeUp = useEffectEvent(() => close(false));

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
        .on("broadcast", { event: "checkin-sync" }, () => resend())
        .on("broadcast", { event: "points-earned" }, (msg) => onPoints(msg.payload))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resend();
        });
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [registerTopic]);

  // Until the register says it has the request, keep sending it: a broadcast
  // nobody was listening for is simply gone.
  useEffect(() => {
    if (step.name !== "waiting" || step.seen) return;
    const request = step.request;
    const resender = setInterval(() => channelRef.current?.send({ type: "broadcast", event: "checkin-request", payload: request }), 8000);
    const slowTimer = setTimeout(() => setSlow(true), 20_000);
    return () => {
      clearInterval(resender);
      clearTimeout(slowTimer);
    };
  }, [step]);

  useEffect(() => {
    const ms = TIMEOUT_MS[step.name];
    if (!ms) return;
    const timer = setTimeout(() => timeUp(), ms);
    return () => clearTimeout(timer);
  }, [step, digits, firstName, email, emailOptIn]);

  function begin(request: CheckinRequest) {
    setSlow(false);
    setError(null);
    send("checkin-request", request);
    setStep({ name: "waiting", request, seen: false });
  }

  function press(key: string) {
    setError(null);
    if (key === "back") setDigits((d) => d.slice(0, -1));
    else if (key === "clear") setDigits("");
    else setDigits((d) => (d.length < 10 ? d + key : d));
  }

  async function lookUp() {
    if (busy || locked || !isFullPhone(digits)) return;
    const ticket = session.current;
    setBusy(true);
    setError(null);
    const r = await startCheckin(digits).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      misses.current += 1;
      if (misses.current >= 5) {
        misses.current = 0;
        setLocked(true);
        setTimeout(() => setLocked(false), 60_000);
      }
    }
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    if (r.status === "new") return setStep({ name: "new" });
    begin(r.request);
  }

  async function signUp() {
    if (busy) return;
    if (!firstName.trim()) return setError("Type your first name.");
    const ticket = session.current;
    setBusy(true);
    setError(null);
    const r = await startNewCheckin({ phone: digits, firstName, email, emailOptIn: emailOptIn && !!email.trim() }).catch(() => null);
    setBusy(false);
    if (ticket !== session.current) return;
    if (!r) return setError(OFFLINE);
    if (!r.ok) return setError(r.error);
    begin(r.request);
  }

  const badAreaCode = digits.length === 10 && !isFullPhone(digits);

  return (
    <>
      {step.name === "closed" && (
        <button
          onClick={() => {
            resetForm();
            setStep({ name: "phone" });
          }}
          // bottom-left, not bottom-right -- the sitewide Dev Notes widget
          // (src/components/DevNotesWidget.tsx) is fixed at bottom-right on
          // every page, including this one, and would otherwise sit right on
          // top of this button.
          className="font-display fixed bottom-6 left-6 z-40 rounded-md border-[3px] px-7 py-4 text-lg uppercase tracking-wide"
          style={{ background: "var(--gold)", color: "var(--foreground)", borderColor: "var(--foreground)", boxShadow: "4px 4px 0 var(--foreground)" }}
        >
          Check in for points
        </button>
      )}

      {step.name !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(20,17,12,0.65)" }}>
          <div className="card w-full max-w-md !p-6 text-center" style={{ background: "var(--surface)" }}>
            <button onClick={() => close(true)} className="mb-2 ml-auto block text-sm text-[var(--muted)]">
              Close ✕
            </button>

            {step.name === "phone" && (
              <>
                <h2 className="font-display mb-1 text-2xl">Check in for points</h2>
                <p className="mb-4 text-sm text-[var(--muted)]">Type your phone number. Your bartender will make sure it&apos;s you.</p>
                <div
                  className="mb-4 rounded-lg border-2 py-3 font-mono text-3xl tabular-nums"
                  style={{ borderColor: "var(--foreground)", minHeight: "3.9rem" }}
                  aria-live="polite"
                  aria-label="Phone number"
                >
                  {digits ? formatPhone(digits) : <span className="text-[var(--muted)]">(___) ___-____</span>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={busy || locked}
                      onClick={() => press(k)}
                      className="h-16 rounded-lg border-2 text-2xl font-bold active:bg-[var(--gold)] disabled:opacity-40"
                      style={{ borderColor: "var(--foreground)" }}
                      aria-label={k === "back" ? "Delete last digit" : k === "clear" ? "Clear" : k}
                    >
                      {k === "back" ? "⌫" : k === "clear" ? <span className="text-sm uppercase tracking-wide">Clear</span> : k}
                    </button>
                  ))}
                </div>
                {(error || badAreaCode) && (
                  <p className="mt-3 text-sm" style={{ color: "var(--danger-text)" }}>
                    {error ?? "Start with your area code."}
                  </p>
                )}
                <button className="btn-primary mt-4 w-full !py-3.5 !text-lg" disabled={busy || locked || !isFullPhone(digits)} onClick={lookUp}>
                  {locked ? "Too many tries. Ask a staff member." : busy ? "Looking you up…" : "Continue"}
                </button>
              </>
            )}

            {step.name === "new" && (
              <>
                <h2 className="font-display mb-1 text-2xl">Welcome to the Royale!</h2>
                <p className="mb-4 text-sm text-[var(--muted)]">
                  {formatPhone(digits)} is new to us. Tell us your first name and you&apos;re in. It&apos;s free, and every dollar earns a point.
                </p>
                <label className="block text-left">
                  <span className="label-xs block">First name</span>
                  <input
                    className="input !text-lg"
                    autoFocus
                    autoComplete="given-name"
                    autoCapitalize="words"
                    maxLength={40}
                    value={firstName}
                    onChange={(e) => {
                      setError(null);
                      setFirstName(e.target.value);
                    }}
                  />
                </label>
                <label className="mt-3 block text-left">
                  <span className="label-xs block">Email (optional)</span>
                  <input
                    className="input !text-lg"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={254}
                    value={email}
                    onChange={(e) => {
                      setError(null);
                      setEmail(e.target.value);
                    }}
                  />
                </label>
                <label className={`mt-3 flex items-start gap-2 text-left text-sm ${email.trim() ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0"
                    checked={emailOptIn && !!email.trim()}
                    disabled={!email.trim()}
                    onChange={(e) => setEmailOptIn(e.target.checked)}
                  />
                  <span>Email me about showings and events at the Royale.</span>
                </label>
                {error && (
                  <p className="mt-3 text-sm" style={{ color: "var(--danger-text)" }}>
                    {error}
                  </p>
                )}
                <div className="mt-5 flex gap-2">
                  <button
                    className="btn-secondary flex-1 !py-3"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setStep({ name: "phone" });
                    }}
                  >
                    Back
                  </button>
                  <button className="btn-primary flex-[2] !py-3 !text-base" disabled={busy || !firstName.trim()} onClick={signUp}>
                    {busy ? "One moment…" : "Check me in"}
                  </button>
                </div>
              </>
            )}

            {step.name === "waiting" && (
              <>
                <h2 className="font-display mb-2 text-2xl">Almost there…</h2>
                <p className="text-base">{step.seen ? "Your bartender is checking it's you." : "Sending it to the register…"}</p>
                {slow && !step.seen && <p className="mt-3 text-sm text-[var(--muted)]">Still waiting on the register. Give your bartender a wave.</p>}
                <div className={styles.dots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <button className="btn-secondary mt-6" onClick={() => close(true)}>
                  Cancel
                </button>
              </>
            )}

            {step.name === "welcome" && (
              <>
                <span className="ctag ctag-yellow mb-4">Checked in</span>
                <h2 className="font-display mb-2 text-3xl">{step.isNew ? `Welcome to the Royale, ${step.firstName}!` : `Welcome back, ${step.firstName}!`}</h2>
                {step.visit && !step.visit.alreadyToday ? (
                  <>
                    <p className="font-display text-4xl" style={{ color: "var(--accent)" }}>
                      +{step.visit.earned} points
                    </p>
                    <p className="mt-1 text-base">
                      for checking in{step.visit.streak > 1 ? ` · 🔥 ${step.visit.streak} visits in a row` : ""}. You have {pts(step.points)}.
                    </p>
                    {step.visit.reward && (
                      <p className="mt-3 rounded-md border-2 px-3 py-2 text-lg font-bold" style={{ borderColor: "var(--foreground)", background: "var(--gold)" }}>
                        🎉 You earned a {REWARD_LABEL[step.visit.reward].toLowerCase()}! Just ask your bartender.
                      </p>
                    )}
                    <StreakPath streak={step.visit.streak} />
                  </>
                ) : step.visit?.alreadyToday ? (
                  <p className="text-base">
                    You&apos;re already checked in today. You have {pts(step.points)}. Come back next time for visit {step.visit.streak + 1} in a row!
                  </p>
                ) : (
                  <p className="text-base">
                    {step.isNew ? "You're all set. Every dollar you spend here earns a point." : `You have ${pts(step.points)}. Today's order adds more.`}
                  </p>
                )}
                <button
                  className="btn-primary mt-5 w-full !py-3 !text-base"
                  onClick={() => {
                    resetForm();
                    setStep({ name: "phone" });
                  }}
                >
                  Next person? Check in →
                </button>
              </>
            )}

            {step.name === "help" && (
              <>
                <h2 className="font-display mb-2 text-2xl">Ask a staff member for help.</h2>
                <p className="text-sm text-[var(--muted)]">They can find your account at the register.</p>
              </>
            )}
          </div>
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
    </>
  );
}
