"use client";

import { useEffect, useRef, useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { firstNameOf, type PlusFinish, type PlusWelcome } from "@/lib/checkin";
import { LEGACY_DEFAULT_INTERVAL, LEGACY_DEFAULT_RATE } from "@/lib/legacy-plus";
import { ANNUAL_DISCOUNT, RATE_LABEL, RATE_ORDER, planPrice, type BillingInterval } from "@/lib/membership-rates";
import type { MemberPriceTier } from "@/lib/types";
import type { PosMember } from "./member-actions";
import { cancelUnlimitedCard, checkUnlimitedCard, startUnlimitedCard, unlimitedDone, unlimitedPhoneLink } from "./legacy-plus-actions";

// "No payment on file for unlimited membership": a former unlimited member
// (lib/legacy-plus.ts) on the order or just checked in. Two ways to set up
// their Insiders+ now, both charged today: their card on the reader, or
// Stripe's page on their own phone (a QR code on the customer screen, or
// an emailed link). If they'd rather not, staff just ring them up like any
// other guest.

export type TabletSend = (event: "plus-finish" | "plus-finish-close" | "plus-welcome", payload: PlusFinish | PlusWelcome | Record<string, never>) => void;

const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

export default function LegacyPlusCard({
  member,
  readerId,
  employeeId,
  onDone,
  toTablet,
}: {
  member: PosMember;
  readerId: string | null;
  employeeId: string;
  // Their Insiders+ is set up: the member as they are now.
  onDone: (m: PosMember) => void;
  toTablet: TabletSend;
}) {
  const [open, setOpen] = useState<"reader" | "phone" | null>(null);
  return (
    <div className="mt-2 overflow-hidden rounded-lg border-2 text-sm" style={{ borderColor: "var(--foreground)" }} role="status">
      <div className="flex items-center gap-1 px-2.5 py-1.5 font-bold leading-tight" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
        <span className="min-w-0 flex-1">No payment on file for unlimited membership</span>
        <InfoTip topic="unlimited-no-payment" className="!mx-0" />
      </div>
      <div className="space-y-2 p-2.5" style={{ background: "var(--surface)" }}>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary min-h-11 !px-2 !py-2 text-sm" onClick={() => setOpen("reader")}>
            Card on reader
          </button>
          <button className="btn-secondary min-h-11 !px-2 !py-2 text-sm" onClick={() => setOpen("phone")}>
            On their phone
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Not paying today? Ring them up like any guest.
        </p>
      </div>
      {open && (
        <SetupModal
          member={member}
          mode={open}
          readerId={readerId}
          employeeId={employeeId}
          toTablet={toTablet}
          onSwitch={(mode) => setOpen(mode)}
          onClose={() => setOpen(null)}
          onDone={(m) => {
            setOpen(null);
            onDone(m);
          }}
        />
      )}
    </div>
  );
}

type Phase =
  | { name: "plan" }
  | { name: "waiting" } // the reader is waiting for their card
  | { name: "qr" } // the QR code is on the customer screen
  | { name: "emailed"; message: string }
  | { name: "done"; message: string; member: PosMember | null }
  // finishId: charged in Stripe but not saved here; Try again finishes that
  // one (never a second charge) instead of starting over.
  | { name: "failed"; message: string; finishId?: string };

function SetupModal({
  member,
  mode,
  readerId,
  employeeId,
  toTablet,
  onSwitch,
  onClose,
  onDone,
}: {
  member: PosMember;
  mode: "reader" | "phone";
  readerId: string | null;
  employeeId: string;
  toTablet: TabletSend;
  onSwitch: (mode: "reader" | "phone") => void;
  onClose: () => void;
  onDone: (m: PosMember) => void;
}) {
  const first = firstNameOf(member.name);
  const [tier, setTier] = useState<MemberPriceTier>(LEGACY_DEFAULT_RATE);
  const [interval, setBilling] = useState<BillingInterval>(LEGACY_DEFAULT_INTERVAL);
  const [idChecked, setIdChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "plan" });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setupRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrUp = useRef(false);

  const needsId = tier !== "adult";
  const plan = { tier, interval, idChecked: !needsId || idChecked };
  const ready = !needsId || idChecked;

  function stopTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  // Leaving with the reader still waiting puts it back; a QR code still up
  // comes down.
  useEffect(
    () => () => {
      stopTimer();
      const id = setupRef.current;
      setupRef.current = null;
      if (id) void cancelUnlimitedCard(id, readerId).catch(() => {});
      if (qrUp.current) toTablet("plus-finish-close", {});
    },
    // Only on the way out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function finish(message: string, m: PosMember | null) {
    stopTimer();
    setupRef.current = null;
    qrUp.current = false;
    setPhase({ name: "done", message, member: m });
    toTablet("plus-welcome", { firstName: first });
  }

  // ---------- their card on the reader ----------
  async function startReader() {
    if (!readerId) return setPhase({ name: "failed", message: "No card reader is chosen for this register. Pick one under Devices." });
    setBusy(true);
    setNote(null);
    const r = await startUnlimitedCard(member.id, readerId, plan, employeeId || null).catch(() => null);
    setBusy(false);
    if (!r) return setPhase({ name: "failed", message: OFFLINE });
    if (!r.ok) return setPhase({ name: "failed", message: r.error });
    setupRef.current = r.setupIntentId;
    setPhase({ name: "waiting" });
    poll(r.setupIntentId);
  }

  // One check at a time, 1.5 s after the last answered.
  function poll(setupIntentId: string) {
    const check = async () => {
      timerRef.current = null;
      const s = await checkUnlimitedCard(setupIntentId, readerId).catch(() => null);
      if (setupRef.current !== setupIntentId) return;
      if (s?.status === "done") return finish(s.message, s.member);
      if (s?.status === "failed") {
        setupRef.current = null;
        return setPhase({ name: "failed", message: s.message });
      }
      if (s?.status === "unsaved") {
        // Charged in Stripe, not saved here: Try again finishes it.
        setupRef.current = null;
        return setPhase({ name: "failed", message: s.message, finishId: setupIntentId });
      }
      timerRef.current = setTimeout(check, 1500);
    };
    timerRef.current = setTimeout(check, 1500);
  }

  async function finishAgain(setupIntentId: string) {
    setBusy(true);
    const s = await checkUnlimitedCard(setupIntentId, readerId).catch(() => null);
    setBusy(false);
    if (s?.status === "done") return finish(s.message, s.member);
    if (s?.status === "failed") return setPhase({ name: "failed", message: s.message });
    setPhase({ name: "failed", message: s?.status === "unsaved" ? s.message : OFFLINE, finishId: setupIntentId });
  }

  async function cancelReader() {
    const id = setupRef.current;
    setupRef.current = null;
    stopTimer();
    if (id) await cancelUnlimitedCard(id, readerId).catch(() => {});
    setPhase({ name: "plan" });
  }

  // ---------- their own phone ----------
  async function showQr() {
    setBusy(true);
    setNote(null);
    const r = await unlimitedPhoneLink(member.id, plan, "tablet", employeeId || null).catch(() => null);
    setBusy(false);
    if (!r) return setNote(OFFLINE);
    if (!r.ok || !r.url) return setNote(r.ok ? "Couldn't make the link. Try again." : r.error);
    toTablet("plus-finish", { firstName: r.firstName, url: r.url, tier, interval });
    qrUp.current = true;
    setPhase({ name: "qr" });
    watch();
  }

  // While the QR code is up: done yet? Every 4 seconds, for up to 10 minutes.
  function watch() {
    const until = Date.now() + 10 * 60_000;
    const check = async () => {
      timerRef.current = null;
      const r = await unlimitedDone(member.id).catch(() => null);
      if (!qrUp.current) return;
      if (r?.done) return finish(`${first} is Insiders+ now.`, r.member);
      if (Date.now() < until) timerRef.current = setTimeout(check, 4000);
    };
    timerRef.current = setTimeout(check, 4000);
  }

  function takeQrDown() {
    stopTimer();
    qrUp.current = false;
    toTablet("plus-finish-close", {});
    setPhase({ name: "plan" });
  }

  async function email() {
    setBusy(true);
    setNote(null);
    const r = await unlimitedPhoneLink(member.id, plan, "email", employeeId || null).catch(() => null);
    setBusy(false);
    if (!r) return setNote(OFFLINE);
    if (!r.ok) return setNote(r.error);
    setPhase({ name: "emailed", message: r.message });
  }

  const failedSetup = phase.name === "failed" ? (phase.finishId ?? null) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm shadow-2xl">
        <h3 className="text-lg font-semibold leading-tight" style={{ color: "var(--foreground)" }}>
          Insiders+ for {first}
        </h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {mode === "reader" ? "Their card on the reader" : "On their own phone"} · charged today, then every {interval}
        </p>

        {phase.name === "plan" && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-1.5">
              {RATE_ORDER.map((t) => (
                <button key={t} className={`chip justify-center !px-1 py-2 text-xs ${t === tier ? "chip-selected" : ""}`} onClick={() => setTier(t)}>
                  {t === "adult" ? "Standard" : RATE_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["month", "year"] as const).map((i) => (
                <button key={i} className={`chip justify-center !px-1 py-2 text-xs ${i === interval ? "chip-selected" : ""}`} onClick={() => setBilling(i)}>
                  {i === "month" ? "Monthly" : `Yearly (${Math.round(ANNUAL_DISCOUNT * 100)}% off)`}
                </button>
              ))}
            </div>
            {needsId && (
              <label className="flex items-start gap-2 rounded-md border p-2 text-sm" style={{ borderColor: "var(--warn-border)", background: "var(--warn-bg)", color: "var(--warn-text)" }}>
                <input type="checkbox" className="mt-1" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} />
                <span>I checked {tier === "senior" ? "an ID showing their age" : "a current student ID"}.</span>
              </label>
            )}
            <div className="text-center">
              <div className="font-display text-2xl" style={{ color: "var(--accent)" }}>
                {planPrice(tier, interval)}
              </div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                plus tax · charged today
              </div>
            </div>
            {note && (
              <p className="text-xs" style={{ color: "var(--danger-text)" }}>
                {note}
              </p>
            )}
            {mode === "reader" ? (
              <button className="btn-primary w-full !py-3 !text-base" disabled={!ready || busy} onClick={startReader}>
                {busy ? "Starting…" : "Tap card on reader"}
              </button>
            ) : (
              <div className="grid gap-2">
                <button className="btn-primary w-full !py-3 !text-base" disabled={!ready || busy} onClick={showQr}>
                  {busy ? "Working…" : "Show QR on customer screen"}
                </button>
                <button className="btn-secondary w-full !py-2" disabled={!ready || busy || !member.email} onClick={email}>
                  {member.email ? "Email them the link" : "No email on file"}
                </button>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <button className="hover:underline" style={{ color: "var(--muted)" }} onClick={onClose}>
                Close
              </button>
              <button className="hover:underline" style={{ color: "var(--accent)" }} onClick={() => onSwitch(mode === "reader" ? "phone" : "reader")}>
                {mode === "reader" ? "On their phone instead" : "Card on reader instead"}
              </button>
            </div>
          </div>
        )}

        {phase.name === "waiting" && (
          <div className="mt-4 text-center">
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Waiting for their card on the reader…
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {planPrice(tier, interval)} plus tax, charged once it&apos;s in.
            </p>
            <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={cancelReader}>
              Cancel
            </button>
          </div>
        )}

        {phase.name === "qr" && (
          <div className="mt-4 text-center">
            <p className="text-sm">The QR code is on the customer screen.</p>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              This updates by itself once they&apos;ve paid.
            </p>
            <button className="btn-secondary mt-4" onClick={takeQrDown}>
              Take QR down
            </button>
          </div>
        )}

        {phase.name === "emailed" && (
          <div className="mt-4 text-center">
            <p className="text-sm">{phase.message}</p>
            <button className="btn-primary mt-4" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {phase.name === "done" && (
          <div className="mt-4 text-center">
            <p className="font-display text-2xl" style={{ color: "var(--accent)" }}>
              ✓ Insiders+
            </p>
            <p className="mt-1 text-sm">{phase.message}</p>
            <button
              className="btn-primary mt-4"
              // Without a fresh copy (a read that failed), as far as is known.
              onClick={() => onDone(phase.member ?? { ...member, tier: "Insiders+", subscribed: true, legacyUnlimited: false })}
            >
              Done
            </button>
          </div>
        )}

        {phase.name === "failed" && (
          <div className="mt-4 text-center">
            <p className="text-sm" style={{ color: "var(--danger-text)" }}>
              {phase.message}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn-secondary" onClick={onClose}>
                Close
              </button>
              {failedSetup ? (
                <button className="btn-primary" disabled={busy} onClick={() => finishAgain(failedSetup)}>
                  {busy ? "Trying…" : "Try again"}
                </button>
              ) : (
                <button className="btn-primary" onClick={() => setPhase({ name: "plan" })}>
                  Try again
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
