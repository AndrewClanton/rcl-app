"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkinTopic, formatPhone, isFullPhone, type CheckinConfirmed, type CheckinRequest, type PointsEarned } from "@/lib/checkin";
import { createKioskMember, startCheckin } from "./actions";
import PointsCelebration from "./PointsCelebration";
import { REWARD_LABEL } from "@/lib/visits";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

type Step =
  | { name: "closed" }
  | { name: "phone" }
  | { name: "new" } // a number we don't know: first and last name
  | { name: "sent" } // a known number, sent to the register; the screen moves on
  | { name: "created"; firstName: string; claimUrl: string | null }; // a new account, made

// Confirmations land as banners across the top, so they never block the
// keypad for the next person.
interface Toast {
  key: number;
  title: string;
  detail: string;
  reward: string | null;
  tone: "ok" | "warn";
}

const OFFLINE = "We couldn't reach the register. Ask a staff member for help.";

// Half-finished screens clear themselves when someone walks away.
const TIMEOUT_MS: Record<Step["name"], number> = { closed: 0, phone: 60_000, new: 90_000, sent: 2_800, created: 25_000 };

// A request the register hasn't answered is resent until it has, and given
// up after this long (the sealed reference expires then anyway).
const OUTBOX_MS = 15 * 60_000;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

// "Check in for points" on the customer screen, built for a line at the
// door: nobody waits on the bartender.
// - A known number goes to the register as an opaque request and the screen
//   is straight back to the keypad. Staff confirm by photo when they can;
//   that pays the visit points, and a banner says so here.
// - An unknown number asks for a first and last name and makes the account
//   right away (email marketing off), then offers a QR code to finish on
//   their own phone. Staff still confirm the visit on the register.
// This screen never shows anyone's details until staff have confirmed:
// then just a first name and points. When a sale with a member on it
// completes, the register says so and the points burst plays here.
// home: the keypad IS the screen (check-in first, when no order is being
// rung up), instead of a button that opens it.
export default function CheckinKiosk({ registerTopic, home = false }: { registerTopic: string; home?: boolean }) {
  const [step, setStep] = useState<Step>({ name: "closed" });
  const [digits, setDigits] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [celebration, setCelebration] = useState<(PointsEarned & { key: number }) | null>(null);
  const channelRef = useRef<Channel | null>(null);
  // Requests sent to the register and not yet answered.
  const outbox = useRef(new Map<string, { request: CheckinRequest; seen: boolean; at: number }>());
  // Bumped on close, so a lookup still in flight when the customer walks
  // away doesn't pop the panel back open.
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

  function close() {
    session.current += 1;
    resetForm();
    setStep({ name: "closed" });
  }

  function toast(t: Omit<Toast, "key">) {
    const key = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { ...t, key }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), t.reward ? 12_000 : 8_000);
  }

  const onSeen = useEffectEvent((id: unknown) => {
    const item = typeof id === "string" ? outbox.current.get(id) : undefined;
    if (item) item.seen = true;
  });

  const onConfirmed = useEffectEvent((p: Partial<CheckinConfirmed> | null) => {
    if (!p || typeof p.id !== "string" || typeof p.firstName !== "string") return;
    // Only our own requests (another screen's check-ins aren't ours to announce).
    if (!outbox.current.delete(p.id)) return;
    const name = p.firstName.slice(0, 40);
    const points = Math.max(0, Math.round(Number(p.points) || 0));
    const v = p.visit;
    const earned = Math.max(0, Math.round(Number(v?.earned) || 0));
    const streak = Math.max(1, Math.round(Number(v?.streak) || 1));
    const reward = v?.reward === "popcorn" || v?.reward === "pizza" ? v.reward : null;
    let detail: string;
    if (v?.alreadyToday) detail = `Already checked in today. You have ${points.toLocaleString("en-US")} points.`;
    else if (v) detail = `+${earned} points${streak > 1 ? ` · 🔥 ${streak} visits in a row` : ""} · ${points.toLocaleString("en-US")} total`;
    else detail = `You have ${points.toLocaleString("en-US")} points.`;
    toast({
      title: p.isNew ? `Welcome to the Royale, ${name}!` : `✓ ${name}, you're checked in`,
      detail,
      reward: reward ? `🎉 You earned a ${REWARD_LABEL[reward].toLowerCase()}! Just ask your bartender.` : null,
      tone: "ok",
    });
  });

  const onDeclined = useEffectEvent((id: unknown) => {
    if (typeof id !== "string" || !outbox.current.delete(id)) return;
    toast({ title: "A check-in couldn't be confirmed", detail: "Please see your bartender.", reward: null, tone: "warn" });
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

  const timeUp = useEffectEvent(() => close());

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
  }, [step, digits, firstName, lastName]);

  // Home keypad: a number typed and walked away from clears itself.
  useEffect(() => {
    if (!home || step.name !== "closed" || !digits) return;
    const timer = setTimeout(() => resetForm(), 45_000);
    return () => clearTimeout(timer);
  }, [home, step.name, digits]);

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
    if (r.status === "known") {
      resetForm();
      return setStep({ name: "sent" });
    }
    resetForm();
    setStep({ name: "created", firstName: r.firstName, claimUrl: r.claimUrl });
  }

  const badAreaCode = digits.length === 10 && !isFullPhone(digits);
  // On the home keypad, "closed" just means waiting for the next person.
  const view: Step = home && step.name === "closed" ? { name: "phone" } : step;
  const onHome = home && step.name === "closed";

  return (
    <>
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[55] mx-auto grid w-[min(34rem,calc(100vw-2rem))] gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.key}
              className="rounded-lg border-[3px] px-5 py-3 text-left shadow-lg"
              style={{ borderColor: "var(--foreground)", background: t.tone === "ok" ? "var(--gold)" : "var(--surface)", color: "var(--foreground)" }}
            >
              <div className="font-display text-xl leading-tight">{t.title}</div>
              <div className="mt-0.5 text-base">{t.detail}</div>
              {t.reward && <div className="mt-1 text-base font-bold">{t.reward}</div>}
            </div>
          ))}
        </div>
      )}

      {step.name === "closed" && !home && (
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

      {view.name !== "closed" && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto p-6 ${home ? "gap-5" : ""}`}
          style={{ background: home ? "var(--background)" : "rgba(20,17,12,0.65)" }}
        >
          {home && view.name === "phone" && (
            <div className="text-center">
              <div className="eyebrow">Royale Cinema Lounge</div>
              <h1 className="font-display mt-1 text-4xl leading-tight md:text-5xl">Welcome! Check in with your number.</h1>
              <p className="mt-1 text-lg text-[var(--muted)]">Every visit earns points. New here? It takes ten seconds.</p>
            </div>
          )}
          <div
            className="card w-full max-w-md !p-6 text-center"
            style={{ background: "var(--surface)", ...(home ? { borderWidth: 3, borderColor: "var(--foreground)", boxShadow: "6px 6px 0 var(--foreground)" } : {}) }}
          >
            {!onHome && view.name !== "sent" && (
              <button onClick={close} className="mb-2 ml-auto block text-sm text-[var(--muted)]">
                {home ? "Start over ✕" : "Close ✕"}
              </button>
            )}

            {view.name === "phone" && (
              <>
                {!home && <h2 className="font-display mb-1 text-2xl">Check in for points</h2>}
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
                      disabled={busy}
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
                <button className="btn-primary mt-4 w-full !py-3.5 !text-lg" disabled={busy || !isFullPhone(digits)} onClick={lookUp}>
                  {busy ? "Looking you up…" : home ? "Check in" : "Continue"}
                </button>
              </>
            )}

            {view.name === "new" && (
              <>
                <h2 className="font-display mb-1 text-3xl">Welcome to the Royale!</h2>
                <p className="mb-4 text-base text-[var(--muted)]">
                  {formatPhone(digits)} is new to us. Tell us your name and you&apos;re in. It&apos;s free, and every visit earns points.
                </p>
                <form
                  className="grid gap-3 text-left"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void signUp();
                  }}
                >
                  <label className="block">
                    <span className="label-xs block">First name</span>
                    <input
                      className="input !py-3 !text-xl"
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
                  <label className="block">
                    <span className="label-xs block">Last name</span>
                    <input
                      className="input !py-3 !text-xl"
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
                  {error && (
                    <p className="text-sm" style={{ color: "var(--danger-text)" }}>
                      {error}
                    </p>
                  )}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary flex-1 !py-3"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setStep({ name: "phone" });
                      }}
                    >
                      Back
                    </button>
                    <button type="submit" className="btn-primary flex-[2] !py-3 !text-lg" disabled={busy || !firstName.trim() || !lastName.trim()}>
                      {busy ? "One moment…" : "Create my account"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {view.name === "sent" && (
              <>
                <span className="ctag ctag-yellow mb-3">Sent</span>
                <h2 className="font-display mb-1 text-3xl">Thanks!</h2>
                <p className="text-lg">Your bartender will confirm you in a moment.</p>
              </>
            )}

            {view.name === "created" && (
              <>
                <span className="ctag ctag-yellow mb-3">You&apos;re in</span>
                <h2 className="font-display mb-1 text-3xl">Welcome, {view.firstName}!</h2>
                <p className="text-lg">Your bartender will confirm your first visit, and your points will land.</p>
                {view.claimUrl && <ClaimQrSlot url={view.claimUrl} />}
                <button className="btn-primary mt-5 w-full !py-3 !text-base" onClick={close}>
                  Done · next person
                </button>
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

// Where the "finish on your phone" QR code goes once claim links exist
// (lib/member-claim.ts). Until then createKioskMember returns no link and
// this isn't shown.
function ClaimQrSlot({ url }: { url: string }) {
  return (
    <p className="mt-4 text-sm">
      Finish your account on your phone: <span className="font-mono break-all">{url}</span>
    </p>
  );
}
