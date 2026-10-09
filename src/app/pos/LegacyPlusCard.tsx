"use client";

import { useEffect, useRef, useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { firstNameOf, type PlusFinish, type PlusWelcome } from "@/lib/checkin";
import { LEGACY_DEFAULT_INTERVAL, LEGACY_DEFAULT_RATE } from "@/lib/legacy-plus";
import { ANNUAL_DISCOUNT, RATE_LABEL, RATE_ORDER, RATE_PRICE, planPrice, type BillingInterval } from "@/lib/membership-rates";
import type { MemberPriceTier } from "@/lib/types";
import type { PosMember } from "./member-actions";
import { cancelUnlimitedCard, checkUnlimitedCard, startUnlimitedCard, unlimitedDone, unlimitedPhoneLink, type PlusReceipt } from "./legacy-plus-actions";
import { membershipReceiptXml } from "@/lib/print/receipt";
import { sendPrint, targetName, usePrintTarget } from "./printing";

// "No payment on file for unlimited membership": a former unlimited member
// (lib/legacy-plus.ts) on the order or just checked in. Two ways to set up
// their Insiders+ now, both charged today: their card on the reader, or
// Stripe's page on their own phone (a QR code on the customer screen, or
// an emailed link). If they'd rather not, staff just ring them up like any
// other guest. On the order it's the red NOT ACTIVE banner across the top
// (UnlimitedBanner, below); just checked in and not on an order yet, it's
// this card on the Customers tab.

export type TabletSend = (event: "plus-finish" | "plus-finish-close" | "plus-welcome", payload: PlusFinish | PlusWelcome | Record<string, never>) => void;

const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

export default function LegacyPlusCard({
  member,
  readerId,
  employeeId,
  onDone,
  toTablet,
  kind = "legacy",
}: {
  member: PosMember;
  readerId: string | null;
  employeeId: string;
  // Their Insiders+ is set up: the member as they are now.
  onDone: (m: PosMember) => void;
  toTablet: TabletSend;
  // legacy: a former unlimited member (red, NOT ACTIVE). nocard: Insiders+
  // by hand with nothing billing them (red). upgrade: any other member,
  // folded away behind one button until staff need it.
  kind?: "legacy" | "nocard" | "upgrade";
}) {
  const [open, setOpen] = useState<"reader" | "phone" | null>(null);
  const [shown, setShown] = useState(kind !== "upgrade");
  if (!shown) {
    return (
      <button className="btn-secondary mt-2 min-h-11 w-full !py-2 text-sm" onClick={() => setShown(true)}>
        {/* Their own rate: a student or senior set at the register shows theirs. */}
        Upgrade to Insiders+ · ${RATE_PRICE[member.price_tier ?? LEGACY_DEFAULT_RATE]}/mo
      </button>
    );
  }
  const headline =
    kind === "legacy" ? "No payment on file for unlimited membership" : kind === "nocard" ? "Insiders+ with no card on file" : "Upgrade to Insiders+";
  // Gold is only for Insiders+ that's active (member-signal.ts): a former
  // unlimited member who isn't paying gets the red NOT ACTIVE look, and
  // Insiders+ with no card on file is red too (the customer screen says so
  // as well). An upgrade is plain.
  const legacy = kind === "legacy";
  return (
    <div className="mt-2 overflow-hidden rounded-lg border-2 text-sm" style={{ borderColor: "var(--foreground)" }} role="status">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 font-bold leading-tight"
        style={kind === "upgrade" ? { background: "var(--surface-hover)", color: "var(--foreground)" } : { background: NOT_ACTIVE_RED, color: "#fff" }}
      >
        {legacy && <NotActiveStamp />}
        <span className="min-w-0 flex-1">{headline}</span>
        {legacy && <InfoTip topic="unlimited-no-payment" className="!mx-0 !text-white" />}
        {kind === "upgrade" && (
          <button className="!mx-0 px-1 text-xs underline" onClick={() => setShown(false)}>
            Hide
          </button>
        )}
      </div>
      <div className="space-y-2 p-2.5" style={{ background: "var(--surface)" }}>
        {/* "On their phone" needs an email (Stripe's page is tied to the
            account by it): a phone account (lib/member-name.ts) only gets
            the reader. */}
        <div className={`grid gap-2 ${member.email ? "grid-cols-2" : "grid-cols-1"}`}>
          <button className="btn-primary min-h-11 !px-2 !py-2 text-sm" onClick={() => setOpen("reader")}>
            Card on reader
          </button>
          {member.email && (
            <button className="btn-secondary min-h-11 !px-2 !py-2 text-sm" onClick={() => setOpen("phone")}>
              On their phone
            </button>
          )}
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {kind === "upgrade"
            ? "Charged today, then every month. Free movies and 10% off start right away."
            : kind === "nocard"
              ? "Charged today, then monthly. The customer screen asks too."
              : "Not paying today? Ring them up like any guest."}
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

// The NOT ACTIVE red: a shade darker than the brand red, so white words on
// it are easy to read.
export const NOT_ACTIVE_RED = "var(--accent-hover)";

// "NOT ACTIVE", stamped in ink: on the order's banner, the Customers tab and
// the member box.
export function NotActiveStamp({ big = false }: { big?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 -rotate-2 items-center rounded border-2 font-black uppercase tracking-wide ${big ? "px-2 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]"}`}
      style={{ background: "var(--foreground)", borderColor: "#fff", color: "#fff" }}
    >
      Not active
    </span>
  );
}

// A former unlimited member with nothing paying for it, on the order: a red
// banner across the top of the order, with the two ways to set it up right
// there, so nobody can miss it or take them for an active Insiders+ member.
// It stays until their Insiders+ is set up or they're taken off the order.
export function UnlimitedBanner({
  member,
  readerId,
  employeeId,
  toTablet,
  onDone,
}: {
  member: PosMember;
  readerId: string | null;
  employeeId: string;
  toTablet: TabletSend;
  onDone: (m: PosMember) => void;
}) {
  const [open, setOpen] = useState<"reader" | "phone" | null>(null);
  // The setup window sits beside the banner, not in it, so it doesn't pick
  // up the banner's white words.
  return (
    <>
      <section
        className="mb-2 rounded-lg border-2 p-2.5 text-white motion-safe:animate-checkin-pulse"
        style={{ background: NOT_ACTIVE_RED, borderColor: "var(--foreground)" }}
        role="status"
        aria-label={`${member.name}: not active, no payment on file for unlimited membership`}
      >
        <div className="flex items-start gap-2">
          <NotActiveStamp big />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-bold">No payment on file for unlimited membership</div>
            <div className="truncate text-xs opacity-90">{member.name}</div>
          </div>
          <InfoTip topic="unlimited-no-payment" className="!mx-0 !text-white" />
        </div>
        <div className={`mt-2 grid gap-2 ${member.email ? "grid-cols-2" : "grid-cols-1"}`}>
          <button
            className="min-h-12 rounded-lg border-2 px-2 text-base font-bold"
            style={{ background: "#fff", borderColor: "var(--foreground)", color: "var(--foreground)" }}
            onClick={() => setOpen("reader")}
          >
            Card on reader
          </button>
          {member.email && (
            <button className="min-h-12 rounded-lg border-2 border-white px-2 text-base font-bold text-white" onClick={() => setOpen("phone")}>
              On their phone
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs opacity-90">Not paying today? Ring them up like any guest.</p>
      </section>
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
    </>
  );
}

type Phase =
  | { name: "plan" }
  | { name: "waiting" } // the reader is waiting for their card
  | { name: "qr" } // the QR code is on the customer screen
  | { name: "emailed"; message: string }
  | { name: "done"; message: string; member: PosMember | null; receipt?: PlusReceipt | null }
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
  const [tier, setTier] = useState<MemberPriceTier>(member.price_tier ?? LEGACY_DEFAULT_RATE);
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

  function finish(message: string, m: PosMember | null, receipt: PlusReceipt | null = null) {
    stopTimer();
    setupRef.current = null;
    qrUp.current = false;
    setPhase({ name: "done", message, member: m, receipt });
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
      if (s?.status === "done") return finish(s.message, s.member, s.receipt ?? null);
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
    if (s?.status === "done") return finish(s.message, s.member, s.receipt ?? null);
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
              {(mode === "phone" || member.email) && (
                <button className="hover:underline" style={{ color: "var(--accent)" }} onClick={() => onSwitch(mode === "reader" ? "phone" : "reader")}>
                  {mode === "reader" ? "On their phone instead" : "Card on reader instead"}
                </button>
              )}
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
            {phase.receipt && <ReceiptShown receipt={phase.receipt} member={phase.member?.name ?? member.name} />}
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

const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

// What was charged, on screen, with Print: Stripe emails its receipt only
// to a customer with an email, so for a phone account (lib/member-name.ts)
// this is their receipt.
function ReceiptShown({ receipt: r, member }: { receipt: PlusReceipt; member: string }) {
  const target = usePrintTarget();
  const [printNote, setPrintNote] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  async function print() {
    if (!target) return;
    setPrinting(true);
    setPrintNote(null);
    const res = await sendPrint(target, "receipt", membershipReceiptXml({ ...r, member }), "Insiders+ receipt").catch(() => null);
    setPrinting(false);
    setPrintNote(res?.ok ? `Receipt sent to ${targetName(target)}.` : `Couldn't print${res && !res.ok ? `: ${res.error}` : ""}. Show them this screen instead.`);
  }

  return (
    <div className="mt-3 rounded-md border p-2.5 text-left text-xs" style={{ borderColor: "var(--border)" }} aria-label="Receipt">
      <div className="mb-1 font-bold">{r.emailed ? "Receipt (Stripe emails them one too)" : "Receipt: no email on file, so print this one"}</div>
      <div className="flex justify-between gap-2">
        <span>{r.plan}</span>
        <span className="tabular-nums">{usd(r.subtotal)}</span>
      </div>
      <div className="flex justify-between gap-2" style={{ color: "var(--muted)" }}>
        <span>Tax</span>
        <span className="tabular-nums">{usd(r.tax)}</span>
      </div>
      <div className="flex justify-between gap-2 font-bold">
        <span>Charged {day(r.at)}</span>
        <span className="tabular-nums">{usd(r.total)}</span>
      </div>
      <div className="mt-1" style={{ color: "var(--muted)" }}>
        {[r.card, r.invoice ? `Invoice ${r.invoice}` : null, r.next ? `Renews ${day(r.next)}` : null].filter(Boolean).join(" · ")}
      </div>
      {target ? (
        <button className="btn-secondary mt-2 min-h-10 w-full !py-1.5 text-sm" disabled={printing} onClick={print}>
          {printing ? "Printing…" : "🖨 Print receipt"}
        </button>
      ) : (
        <div className="mt-2" style={{ color: "var(--muted)" }}>
          No printer set up on this register: show them this screen.
        </div>
      )}
      {printNote && <div className="mt-1">{printNote}</div>}
    </div>
  );
}
