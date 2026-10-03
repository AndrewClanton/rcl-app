"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AudienceCount, DesignResults, WaveResult } from "@/lib/email/designs/ready";
import type { DesignKey } from "@/lib/email/designs/types";
import { UNDO_STOP_BEFORE_MS } from "@/lib/email/undo";
import { pauseDesign, resumeDesign, saveResendPlan, saveWaveModeAction, saveWaveSizeAction, sendDesign, sendDesignTest, sendNextWave, undoDesignWave } from "./actions";

// The Ready to send screen: the three ready-made emails as cards. Each has
// its preview (desktop, phone, plain text), who it would go to right now,
// "Send me a test", "Send to N people" (with a confirm step), and how it
// did, overall and wave by wave (daily waves, most engaged first, so wave 1
// can be judged before wave 2). The words on the screen are for staff
// who've never sent an email campaign: plain, and nothing to configure
// (admins get the wave size and the plan's numbers).

export interface CardData {
  key: DesignKey;
  title: string;
  about: string;
  who: string;
  subject: string;
  preheader: string;
  desktopHtml: string;
  loginHtml: string | null;
  text: string;
  count: AudienceCount | null;
  days: number | null;
  finish: string | null;
  overMonth: boolean;
  status: string | null;
  note: string | null;
  brake: string | null; // the automatic brake stopped it: why ("Paused: 7 of 100 in wave 2 bounced. ...")
  atResend: number; // handed to Resend to arrive later (Pause calls these back)
  campaignId: string | null;
  results: DesignResults | null;
  outcomeLabel: string;
  outcomeAbout: string;
  sendKey: string; // a fresh one each time the page loads: a double click reuses it
  undo: UndoCard | null; // the wave just pressed for, while it can be undone or is on its way
  undoMinutes: number | null; // the next wave waits this long at Resend, so it can be undone (null: too big to)
}

// The minute to undo, from what's saved on the email (so a reload shows the
// same time left). Times are the server's (ms).
export interface UndoCard {
  key: string;
  wave: number;
  people: number;
  until: number; // the end of the minute
  arrives: number; // when it's due in their inboxes
  arrivesLabel: string; // "5:12 PM"
  first: boolean;
  started: boolean; // Undo was pressed and hasn't finished (pressing again carries on)
  undoing: boolean; // ...and is calling back right now
}

export interface PlanData {
  daily: number;
  monthly: number;
  reserve: number;
  perDay: number;
  firstWave: number; // a Send that starts afresh goes to only this many first (25, or the wave size if smaller)
  perMonth: number;
  usedToday: number;
  usedMonth: number;
  todayLeft: number;
  monthLeft: number;
  nextWave: string; // "Sat, Oct 3": automatic, the next morning run's wave; manual, the next day one can go once today's share has gone
  auto: boolean; // later waves go by themselves (an admin setting); otherwise staff press for each
  goesAt: string; // "now", or "at 10:30 AM Sat, Oct 3" outside sending hours
}

const n = (x: number) => x.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const people = (x: number) => `${n(x)} ${x === 1 ? "person" : "people"}`;

// Why sending can't happen right now, who can fix it, and where.
export interface Blocker {
  text: string;
  href?: string;
  label?: string;
}

function BlockerLink({ b }: { b: Blocker }) {
  return b.href ? (
    <Link href={b.href} className="btn-secondary !px-3 !py-1 text-xs">
      {b.label ?? "Go there"}
    </Link>
  ) : null;
}

const SPACED_DAYS = 3;

// The server's clock is the reference (it's the one that decides whether
// the minute is up); the offset is refreshed on every server render.
let clockOffset = 0;
const subscribeClock = (cb: () => void) => {
  const id = setInterval(cb, 250);
  return () => clearInterval(id);
};
const getClockSecond = () => Math.floor((Date.now() + clockOffset) / 1000);
const getZero = () => 0;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// "Wave 2 is on its way to 80 people. Undo (0:59)", then "On its way.
// Arrives about 5:12 PM." until it's due.
function UndoBar({ undo, status, busy, onUndo }: { undo: UndoCard; status: string | null; busy: boolean; onUndo: () => void }) {
  const second = useSyncExternalStore(subscribeClock, getClockSecond, getZero);
  // Nothing time-dependent on the server's render (no flash of the wrong time).
  if (!second) return null;
  const now = second * 1000;
  const left = Math.max(0, Math.ceil((undo.until - now) / 1000));
  const canUndo = left > 0 || (undo.started && now < undo.arrives - UNDO_STOP_BEFORE_MS);
  const onItsWay = status === "scheduled" || status === "sending" || status === "sent";
  if (!canUndo) {
    if (!onItsWay || now >= undo.arrives) return null;
    return (
      <p className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm" role="status">
        <strong>Wave {undo.wave} is on its way.</strong> Arrives about {undo.arrivesLabel}.
      </p>
    );
  }
  const what = undo.undoing
    ? `Calling back wave ${undo.wave}…`
    : undo.started
      ? `Wave ${undo.wave} isn't all called back yet.`
      : status === "paused"
        ? `Wave ${undo.wave} (${people(undo.people)}) is paused.`
        : `Wave ${undo.wave} is on its way to ${people(undo.people)}.`;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-[var(--foreground)] bg-[var(--background)] p-3 text-sm">
      <p className="min-w-0 flex-1" role="status">
        <strong>{what}</strong>{" "}
        <span className="text-[var(--muted)]">
          {undo.started ? `Press Undo to finish calling it back before ${undo.arrivesLabel}.` : `It arrives about ${undo.arrivesLabel}. Undo calls back every one of them.`}
        </span>
      </p>
      <button type="button" className="btn-secondary min-h-11 min-w-32 !px-5 text-base tabular-nums" disabled={busy} onClick={onUndo}>
        {busy ? "Calling back…" : left > 0 ? `Undo (${mmss(left)})` : "Undo"}
      </button>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

const waveDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Each wave's results, so wave 1 can be judged before wave 2 goes.
function Waves({ waves, outcomeLabel }: { waves: WaveResult[]; outcomeLabel: string }) {
  const cell = (a: number, b: number) => (
    <>
      {n(a)} <span className="text-[var(--muted)]">{pct(a, b)}</span>
    </>
  );
  return (
    <div className="mt-4 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Wave by wave</div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full min-w-[560px] text-sm tabular-nums">
          <thead className="text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-normal">Wave</th>
              <th className="px-3 py-2 font-normal">Sent</th>
              <th className="px-3 py-2 font-normal">Opened (rough)</th>
              <th className="px-3 py-2 font-normal">Clicked</th>
              <th className="px-3 py-2 font-normal">{outcomeLabel}</th>
              <th className="px-3 py-2 font-normal">Unsubscribed · bounced</th>
            </tr>
          </thead>
          <tbody>
            {waves.map((w) => (
              <tr key={w.day} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <strong>{w.n}</strong> <span className="text-[var(--muted)]">{waveDay(w.day)}</span>
                </td>
                <td className="px-3 py-2">
                  {n(w.sent)}
                  {w.waiting ? <span className="text-[var(--muted)]"> +{n(w.waiting)} waiting</span> : null}
                </td>
                <td className="px-3 py-2">{cell(w.opened, w.delivered)}</td>
                <td className="px-3 py-2">{cell(w.clicked, w.delivered)}</td>
                <td className="px-3 py-2">{cell(w.outcome, w.outcomeOf)}</td>
                <td className="px-3 py-2">
                  {n(w.unsubscribed)} · {n(w.bounced)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Opened and clicked are out of those delivered; {outcomeLabel.toLowerCase()} is out of those it could apply to. Results keep coming in for a few days after each wave.
      </p>
    </div>
  );
}

function Preview({ card }: { card: CardData }) {
  const [view, setView] = useState<"desktop" | "phone" | "text">("desktop");
  const [as, setAs] = useState<"claim" | "login">("claim");
  const html = as === "login" && card.loginHtml ? card.loginHtml : card.desktopHtml;
  return (
    <div className="min-w-0 space-y-2">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
        <div className="text-xs text-[var(--muted)]">In their inbox</div>
        <div className="mt-1">
          <strong>{card.subject}</strong> <span className="text-[var(--muted)]">— {card.preheader}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["desktop", "phone", "text"] as const).map((v) => (
          <button key={v} type="button" className={`chip !px-3 !py-1 !text-xs ${view === v ? "chip-selected" : ""}`} onClick={() => setView(v)}>
            {v === "desktop" ? "Computer" : v === "phone" ? "Phone" : "Plain text"}
          </button>
        ))}
        {card.loginHtml && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={`chip !px-3 !py-1 !text-xs ${as === "claim" ? "chip-selected" : ""}`} onClick={() => setAs("claim")}>
              No website login yet
            </button>
            <button type="button" className={`chip !px-3 !py-1 !text-xs ${as === "login" ? "chip-selected" : ""}`} onClick={() => setAs("login")}>
              Already signed up
            </button>
          </span>
        )}
      </div>
      {view === "text" ? (
        <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-white p-4 text-xs text-black">{card.text}</pre>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[#14110c]">
          <iframe title={`${card.title} preview`} srcDoc={html} sandbox="" className="mx-auto block h-[720px] bg-[#14110c]" style={{ width: view === "phone" ? 375 : 620, maxWidth: view === "phone" ? 375 : "none" }} />
        </div>
      )}
      <p className="text-xs text-[var(--muted)]">
        Shown as it would look for a member named Sam. Each person sees their own first name, and their own button.
      </p>
    </div>
  );
}

function Card({
  card,
  plan,
  blocker,
  canTest,
  testBlocker,
  myEmail,
  isSender,
  senderNames,
}: {
  card: CardData;
  plan: PlanData;
  blocker: Blocker | null;
  canTest: boolean;
  testBlocker: Blocker | null;
  myEmail: string;
  isSender: boolean;
  senderNames: string; // "Nathan and Mary"
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Undo has its own, so nothing else running on the card holds it up.
  const [undoing, startUndo] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"first" | "next" | null>(null);
  const [checked, setChecked] = useState("");
  const canSend = !blocker;
  const blockedWhy = blocker?.text ?? null;
  const count = card.count?.willSend ?? 0;
  const next = card.count?.next ?? { n: 0, mix: [] };
  const spaced = card.count?.spaced ?? [];
  const spacedTotal = spaced.reduce((a, s) => a + s.n, 0);
  const going = card.status === "scheduled" || card.status === "sending";
  const paused = card.status === "paused";
  const r = card.results;
  const lastWave = r?.waves.at(-1) ?? null;
  const waiting = r?.waiting ?? 0;
  const left = count + waiting;
  const allSpaced = count > 0 && next.n === 0 && spacedTotal > 0 ? `Everyone left had another ready-made email in the last ${SPACED_DAYS} days. They can get this one in a later wave.` : null;
  // Manual waves: why "Send the next wave" can't be pressed right now.
  const nextWhy = !canSend
    ? blockedWhy
    : count === 0
      ? "Everyone it's for has had it."
      : waiting > 0
        ? "The last wave is still going out."
        : plan.todayLeft <= 0
          ? `Today's share has gone. The next wave can go ${plan.nextWave}.`
          : allSpaced;
  const firstWhy = !canSend ? blockedWhy : !plan.auto && plan.todayLeft <= 0 ? `Today's share has gone. The first wave can go ${plan.nextWave}.` : allSpaced;
  const run = (what: string, fn: () => Promise<{ ok: boolean; text: string }>) =>
    start(async () => {
      setMsg({ ok: true, text: `${what}…` });
      const out = await fn().catch(() => ({ ok: false, text: "Couldn't reach the server. Check the connection and try again." }));
      setMsg(out);
      router.refresh();
    });
  const resume = () =>
    run("Carrying on", async () => {
      const out = await resumeDesign(card.key, checked);
      return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
    });
  const pause = (what: string) =>
    run(what, async () => {
      const out = await pauseDesign(card.key);
      return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
    });
  const undo = () => {
    const u = card.undo;
    if (!u || !card.campaignId) return;
    const id = card.campaignId;
    startUndo(async () => {
      setMsg({ ok: true, text: "Calling back the wave…" });
      const out = await undoDesignWave(card.key, id, u.key).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Press Undo again." }));
      setMsg(out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error });
      router.refresh();
    });
  };
  const firstLabel = count === 0 ? "Nobody to send it to" : plan.auto || count <= next.n ? `Send to ${people(count)}` : `Send the first ${n(next.n)} (of ${n(count)})`;
  const nextLabel = `Send the next ${n(Math.min(next.n, count) || plan.perDay)}`;
  const waveLine = paused
    ? plan.auto
      ? "paused: the next wave goes when you press Carry on sending"
      : "paused: press Carry on sending, then Send the next wave"
    : left === 0
      ? "the last wave has gone"
      : plan.auto
        ? `next wave ${plan.nextWave}`
        : waiting > 0
          ? "this wave is still going out"
          : plan.todayLeft > 0
            ? `next wave when you press ${nextLabel}`
            : `next wave can go ${plan.nextWave}`;

  return (
    <section id={card.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{card.title}</h2>
        <p className="text-sm text-[var(--muted)]">{card.about}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Preview card={card} />
        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Who gets it</div>
            <p className="mt-1">{card.who}</p>
            {card.count ? (
              <>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{people(count)}</div>
                <div className="text-xs text-[var(--muted)]">{card.campaignId ? "haven't had it yet and would get it" : "would get it"}</div>
                {spaced.map((s) => (
                  <p key={s.title} className="mt-1 text-xs">
                    {n(s.n)} of them got <em>{s.title}</em> in the last {SPACED_DAYS} days, so they&apos;ll get this one in a later wave.
                  </p>
                ))}
                {card.count.excluded.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-[var(--muted)]">Who&apos;s left out, and why</summary>
                    <ul className="mt-1 space-y-0.5">
                      {card.count.excluded.slice(0, 8).map((e) => (
                        <li key={e.why} className="flex justify-between gap-3">
                          <span>{e.why}</span>
                          <span className="tabular-nums">{n(e.n)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-[var(--danger-text)]">Couldn&apos;t count them just now. Reload the page.</p>
            )}
          </div>

          {paused && card.brake && (
            <div className="space-y-2 rounded-lg border-2 border-[var(--danger-text)] bg-[var(--background)] p-3 text-sm" role="alert">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--danger-text)]">Stopped by the automatic brake</div>
              <p className="font-semibold text-[var(--danger-text)]">{card.brake}</p>
              <p className="text-xs text-[var(--muted)]">
                Nothing more of this email goes until someone carries on. Look at who bounced or complained (More detail, below): old or mistyped addresses, or
                people who never asked for email. Bounced addresses are already on the never-mail list, so they won&apos;t be sent to again.
              </p>
              {isSender ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input !w-auto min-w-56 flex-1 text-sm"
                    placeholder="What you checked (required)"
                    value={checked}
                    onChange={(e) => setChecked(e.target.value)}
                    aria-label="What you checked"
                  />
                  <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={pending || !canSend || checked.trim().length < 5} title={blockedWhy ?? undefined} onClick={resume}>
                    I&apos;ve checked: carry on
                  </button>
                </div>
              ) : (
                <p className="text-xs">{senderNames || "Whoever sends email"} can carry on here once they&apos;ve checked the list.</p>
              )}
            </div>
          )}

          {(going || paused || card.status === "sent") && r && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{going ? "Going out in waves" : paused ? "Paused" : "Sent"}</div>
              <p className="mt-1">
                {n(r.sent)} sent so far{going || paused ? `, ${n(left)} to go` : ""}.
              </p>
              {(going || paused) && (
                <p className="mt-1 font-semibold">
                  Waves of {n(plan.perDay)} · {waveLine}
                </p>
              )}
              {card.note && (going || paused) && <p className="mt-1 text-xs text-[var(--muted)]">{card.note}</p>}
            </div>
          )}
          {!going && !paused && card.count && count > 0 && (
            <p className="text-xs text-[var(--muted)]">
              Goes out in waves, the members most used to hearing from us first: the first wave to {n(Math.min(next.n || plan.firstWave, count))}
              {count > (next.n || plan.firstWave) ? `, then ${n(plan.perDay)} at a time` : ""}.{" "}
              {plan.auto
                ? "After the first, one goes each morning (Monday to Saturday); check how wave 1 did, and Pause if something's wrong."
                : "After the first, each wave goes only when someone presses Send the next wave here, so check how the last one did first."}
            </p>
          )}

          {card.undo && <UndoBar undo={card.undo} status={card.status} busy={undoing} onUndo={undo} />}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary !px-4 !py-2 text-sm"
              disabled={pending || !canTest}
              title={canTest ? `Sends this email to ${myEmail}` : (testBlocker?.text ?? undefined)}
              onClick={() =>
                run("Sending your test", async () => {
                  const out = await sendDesignTest(card.key);
                  return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                })
              }
            >
              Send me a test
            </button>
            {going && !plan.auto && (
              <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={pending || !!nextWhy} title={nextWhy ?? undefined} onClick={() => setConfirm("next")}>
                {nextLabel}
              </button>
            )}
            {paused ? (
              <>
                {!card.brake && (
                  <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={pending || !canSend} title={blockedWhy ?? undefined} onClick={resume}>
                    Carry on sending
                  </button>
                )}
                {card.atResend > 0 && (
                  <button type="button" className="btn-secondary !px-4 !py-2 text-sm" disabled={pending} onClick={() => pause("Calling back")}>
                    Call back the {n(card.atResend)} still waiting at Resend
                  </button>
                )}
              </>
            ) : going ? (
              <button
                type="button"
                className="btn-secondary !px-4 !py-2 text-sm"
                disabled={pending}
                title={card.atResend > 0 ? `Also calls back the ${n(card.atResend)} handed to Resend that haven't arrived yet` : undefined}
                onClick={() => pause("Pausing")}
              >
                Pause
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary !px-4 !py-2 text-sm"
                disabled={pending || !!firstWhy || count === 0}
                title={firstWhy ?? undefined}
                onClick={() => setConfirm("first")}
              >
                {firstLabel}
              </button>
            )}
          </div>
          {going && !plan.auto && nextWhy && <p className="text-xs text-[var(--muted)]">{nextWhy}</p>}
          {msg && <p className={`text-sm ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}

          {r && r.sent > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">How it did</div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Sent" value={n(r.sent)} sub={r.waiting ? `${n(r.waiting)} waiting to go` : undefined} />
                <Stat label="Delivered" value={n(r.delivered)} sub={pct(r.delivered, r.sent)} />
                <Stat label="Opened (rough)" value={n(r.opened)} sub={pct(r.opened, r.delivered)} />
                <Stat label="Clicked" value={n(r.clicked)} sub={pct(r.clicked, r.delivered)} />
                <Stat label={card.outcomeLabel} value={n(r.outcome)} sub={`of ${n(r.outcomeOf)} · ${card.outcomeAbout.toLowerCase()}`} />
                <Stat label="Unsubscribed · bounced" value={`${n(r.unsubscribed)} · ${n(r.bounced)}`} />
              </div>
              {card.campaignId && (
                <Link href={`/admin/email/${card.campaignId}`} className="text-xs underline">
                  More detail (links clicked, who it didn&apos;t go to)
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {r && r.waves.length > 0 && <Waves waves={r.waves} outcomeLabel={card.outcomeLabel} />}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby={`confirm-${card.key}`}>
          <div className="card max-h-[90vh] w-full max-w-md overflow-y-auto shadow-2xl">
            <h3 id={`confirm-${card.key}`} className="text-lg font-semibold">
              {confirm === "next" ? `${nextLabel} of “${card.title}”?` : plan.auto || count <= next.n ? `Send “${card.title}” to ${people(count)}?` : `Send the first ${n(next.n)} of “${card.title}”?`}
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted)]">Who&apos;s {confirm === "next" ? "next" : "first"}</dt>
                <dd>
                  {n(Math.min(next.n, count))} of the {people(count)} {card.campaignId ? "left" : "it's for"}, the most engaged first:
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {next.mix.map((g) => (
                      <li key={g.label} className="flex justify-between gap-3">
                        <span>{g.label}</span>
                        <span className="tabular-nums">{n(g.n)}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              {spaced.length > 0 && (
                <div>
                  <dt className="text-xs text-[var(--muted)]">Kept apart (at least {SPACED_DAYS} days between these emails)</dt>
                  <dd className="space-y-0.5">
                    {spaced.map((s) => (
                      <p key={s.title}>
                        {n(s.n)} of these got <em>{s.title}</em> in the last {SPACED_DAYS} days. They&apos;ll get this one later.
                      </p>
                    ))}
                  </dd>
                </div>
              )}
              {confirm === "next" && lastWave && (
                <div>
                  <dt className="text-xs text-[var(--muted)]">
                    How wave {lastWave.n} did ({waveDay(lastWave.day)})
                  </dt>
                  <dd>
                    {n(lastWave.sent)} sent · {n(lastWave.delivered)} delivered · {n(lastWave.opened)} opened (rough) · {n(lastWave.clicked)} clicked · {n(lastWave.outcome)}{" "}
                    {card.outcomeLabel.toLowerCase()} · {n(lastWave.unsubscribed)} unsubscribed · {n(lastWave.bounced)} bounced
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-[var(--muted)]">When</dt>
                <dd>
                  {plan.goesAt !== "now"
                    ? `It goes ${plan.goesAt} (email only goes out 9 AM to 7 PM, Monday to Saturday).`
                    : card.undoMinutes
                      ? `In about ${card.undoMinutes} minutes (it waits at Resend first, so it can be undone).`
                      : "Now."}{" "}
                  {confirm === "next" || !plan.auto
                    ? `After this wave, nothing more goes until someone presses Send the next wave here (at most ${n(plan.perDay)} a day).`
                    : `Then one wave of up to ${n(plan.perDay)} each morning, so about ${card.days ?? "?"} sending ${card.days === 1 ? "day" : "days"}${card.finish ? `, finishing around ${card.finish}` : ""}.`}
                  {card.overMonth ? ` That's more than this month's ${n(plan.monthLeft)} left on our email plan, so some wait for next month.` : ""}
                </dd>
              </div>
              {confirm === "first" && (
                <div>
                  <dt className="text-xs text-[var(--muted)]">Subject</dt>
                  <dd>{card.subject}</dd>
                </div>
              )}
            </dl>
            {card.undoMinutes && (
              <p className="mt-3 text-sm">
                <strong>You&apos;ll have one minute to undo it.</strong> Undo calls back the whole wave before anyone gets it.
              </p>
            )}
            <p className="mt-3 text-xs text-[var(--muted)]">
              A wave can&apos;t be taken back once it arrives. Anyone who no longer fits by then (signed up meanwhile, turned email off) is skipped. You can pause at any
              time, and Pause also calls back any of the wave still waiting to arrive. If too many bounce or anyone marks it as spam, the next wave won&apos;t go until
              someone who sends email has checked.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const which = confirm;
                  setConfirm(null);
                  if (which === "next") {
                    run("Sending the next wave", async () => {
                      const out = await sendNextWave(card.key, card.sendKey);
                      return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                    });
                  } else {
                    run("Sending the first wave", async () => {
                      const out = await sendDesign(card.key, card.sendKey);
                      return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                    });
                  }
                }}
              >
                {confirm === "next" ? nextLabel : firstLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Admins: how many each day's wave goes to (Resend's daily figure becomes
// this plus what's kept back for receipts).
function WaveSize({ plan }: { plan: PlanData }) {
  const router = useRouter();
  const [size, setSize] = useState(String(plan.perDay));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3">
      <label className="text-xs">
        Wave size (admins)
        <input className="input mt-1 !w-28" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn-secondary !px-4 !py-2 text-sm"
        disabled={pending || Number(size) === plan.perDay}
        onClick={() =>
          start(async () => {
            const out = await saveWaveSizeAction(Number(size)).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            setMsg(out.ok ? `Saved: waves of ${n(out.size)} from the next wave.` : out.error);
            router.refresh();
          })
        }
      >
        Save
      </button>
      {msg && <span className="text-xs">{msg}</span>}
    </div>
  );
}

// Admins: whether waves after the first wait for staff to press "Send the
// next wave" (the default) or go by themselves each morning.
function WaveMode({ plan }: { plan: PlanData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const pick = (auto: boolean) => {
    if (auto === plan.auto) return;
    if (auto && !window.confirm("Waves would then go out by themselves each morning, with nobody pressing anything. Switch?")) return;
    start(async () => {
      const out = await saveWaveModeAction(auto).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      setMsg(out.ok ? "Saved." : out.error);
      router.refresh();
    });
  };
  return (
    <div className="mt-2 text-xs">
      <div className="text-[var(--muted)]">Waves after the first (admins)</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" className={`chip !px-3 !py-1 !text-xs ${!plan.auto ? "chip-selected" : ""}`} disabled={pending} onClick={() => pick(false)}>
          Only when staff press Send the next wave
        </button>
        <button type="button" className={`chip !px-3 !py-1 !text-xs ${plan.auto ? "chip-selected" : ""}`} disabled={pending} onClick={() => pick(true)}>
          By themselves each morning
        </button>
        {msg && <span>{msg}</span>}
      </div>
    </div>
  );
}

function PlanEditor({ plan }: { plan: PlanData }) {
  const router = useRouter();
  const [daily, setDaily] = useState(String(plan.daily));
  const [monthly, setMonthly] = useState(String(plan.monthly));
  const [reserve, setReserve] = useState(String(plan.reserve));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs text-[var(--muted)]">Upgraded the Resend plan? Change the numbers (admins)</summary>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          A day
          <input className="input mt-1 !w-28" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </label>
        <label className="text-xs">
          A month
          <input className="input mt-1 !w-28" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <label className="text-xs">
          Kept back each day for receipts
          <input className="input mt-1 !w-28" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-secondary !px-4 !py-2 text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const out = await saveResendPlan(Number(daily), Number(monthly), Number(reserve)).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
              setMsg(out.ok ? "Saved." : out.error);
              router.refresh();
            })
          }
        >
          Save
        </button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>
    </details>
  );
}

export default function ReadyToSend({
  cards,
  sendingOn,
  offReason,
  offKind,
  stopped,
  picturesReady,
  countsFailed,
  plan,
  isAdmin,
  sender,
  myEmail,
  serverNow,
}: {
  cards: CardData[];
  sendingOn: boolean;
  offReason: string | null;
  offKind: "master" | "switch" | "setup" | null;
  stopped: string | null;
  picturesReady: boolean;
  countsFailed: boolean;
  plan: PlanData;
  isAdmin: boolean;
  // Whether this person may send to members, who may, and if not, why
  // (lib/email/senders.ts).
  sender: { ok: boolean; names: string; why: string | null };
  myEmail: string;
  serverNow: number;
}) {
  useEffect(() => {
    clockOffset = serverNow - Date.now();
  }, [serverNow]);
  // Who can fix each thing, and where (no dead ends).
  const toSwitch = { href: "/admin/email#sending", label: "Go to Sending on/off" };
  const offBlocker: Blocker | null = sendingOn
    ? null
    : offKind === "switch"
      ? { text: "Sending is switched off. An owner can turn it on from the Email page.", ...toSwitch }
      : offKind === "master"
        ? { text: "Sending is switched off at the top level (Vercel). An owner turns that on once, then uses the switch on the Email page.", ...toSwitch }
        : { text: `Sending isn't set up yet: ${offReason ?? "see the go-live checklist on the Email page."}`, href: "/admin/email", label: "See the go-live checklist" };
  const senderBlocker: Blocker | null = sender.ok ? null : { text: sender.why ?? "Only the people picked to send email can send it to members.", href: "/admin/email#senders", label: "See who sends" };
  const blocker: Blocker | null =
    senderBlocker ??
    offBlocker ??
    (stopped
      ? { text: "Sending is stopped. Someone who sends email can resume it on the Email page.", href: "/admin/email", label: "Go to the Email page" }
      : !picturesReady
        ? { text: "The pictures for these emails aren't on our picture server yet.", href: "/admin/email", label: "See the go-live checklist" }
        : null);
  const testBlocker = offBlocker ?? (stopped ? blocker : null);
  return (
    <div className="space-y-6">
      {senderBlocker && (
        <div className="notice space-y-2 text-sm">
          <p>{senderBlocker.text}</p>
          <BlockerLink b={senderBlocker} />
        </div>
      )}
      {offBlocker && (
        <div className="notice notice-warn space-y-2 text-sm">
          <p>
            <strong>{offBlocker.text}</strong> Nothing goes out while it&apos;s off: not these emails, not tests. You can still look at each one and see who it would go to.
          </p>
          {isAdmin && offReason && offKind === "setup" ? <p className="text-xs">Why: {offReason}</p> : null}
          <BlockerLink b={offBlocker} />
        </div>
      )}
      {stopped && (
        <div className="notice notice-warn space-y-2 text-sm">
          <p>
            <strong>Sending is stopped right now.</strong> {stopped} Someone who sends email can resume it on the Email page once they&apos;ve checked what happened.
          </p>
          <Link href="/admin/email" className="btn-secondary !px-3 !py-1 text-xs">
            Go to the Email page
          </Link>
        </div>
      )}
      {!picturesReady && (
        <div className="notice notice-warn space-y-2 text-sm">
          <p>
            <strong>The pictures for these emails aren&apos;t on our picture server yet,</strong> so they can&apos;t go out (the previews below may show broken pictures). The
            go-live checklist on the Email page shows which are missing.
          </p>
          <Link href="/admin/email" className="btn-secondary !px-3 !py-1 text-xs">
            See the go-live checklist
          </Link>
        </div>
      )}
      {countsFailed && <p className="notice notice-warn text-sm">Couldn&apos;t count who each email would go to just now. Reload the page.</p>}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <h2 className="font-semibold">How this works</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            <strong>Look.</strong> Each email shows below as members will see it. Switch between <em>Computer</em> and <em>Phone</em>; <em>Plain text</em> is the version
            for mail apps that don&apos;t show pictures.
          </li>
          <li>
            <strong>Send yourself a test.</strong> &ldquo;Send me a test&rdquo; sends it to your own inbox ({myEmail}) with your name in it. Open it on your phone and tap
            around. In a test, the main button opens the ordinary sign-in or membership page, not anyone&apos;s own link.
          </li>
          <li>
            <strong>Send, a wave at a time.</strong> The send button shows exactly who&apos;s first and how many, and asks you to confirm. Each person gets it once,
            with their own first name and their own button. It goes out in waves, the members most used to hearing from us first (whoever came in, bought or tapped
            an email most lately, then whoever said yes to email most recently, then our longest-standing members):{" "}
            {plan.firstWave < plan.perDay ? `the first wave to just ${n(plan.firstWave)}, then ${n(plan.perDay)} at a time` : `${n(plan.perDay)} at a time`}, so if
            something&apos;s wrong, few people see it.{" "}
            {plan.auto
              ? "After the first wave, one goes each morning (Monday to Saturday) until everyone has it. You can pause it any time."
              : "After the first wave, nothing more goes until someone presses Send the next wave (at most one wave a day). You can pause it any time."}{" "}
            For one minute after you press Send (or Send the next wave), <strong>Undo</strong> calls the whole wave back before anyone gets it: a wave you send waits a few
            minutes at Resend first, just for this (waves that go by themselves don&apos;t).
          </li>
          <li>
            <strong>Read the results, wave by wave.</strong> <em>Delivered</em> reached their inbox. <em>Opened</em> is rough (some phones open every email by
            themselves). <em>Clicked</em> tapped something. The number that matters is the last one: who <em>signed in</em> (the first two emails) or{" "}
            <em>set up Insiders+</em> (the third) since it went. If a wave has trouble (unsubscribes, bounces, or nobody clicking), don&apos;t send the next one: press
            Pause. The automatic brake also stops an email by itself if more than 5 in 100 of a wave bounce or anyone marks it as spam; someone who sends email
            carries on after checking.
          </li>
        </ol>
        <p className="mt-2 text-xs text-[var(--muted)]">
          These three are kept at least {SPACED_DAYS} days apart for each person: anyone who just got one of the others waits for a later wave.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Nobody who turned email off, unsubscribed, or whose address bounced ever gets these. Every email has an unsubscribe link and our street address at the bottom.
        </p>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <h2 className="font-semibold">
          {plan.firstWave < plan.perDay ? `First wave ${n(plan.firstWave)}, then waves of ${n(plan.perDay)}` : `Waves of ${n(plan.perDay)}`} ·{" "}
          {!cards.some((c) => c.status === "scheduled" || c.status === "sending")
            ? "the first goes when you press Send"
            : plan.auto
              ? `next wave ${plan.nextWave}`
              : plan.todayLeft > 0
                ? "next wave when you press Send the next wave"
                : `next wave can go ${plan.nextWave}`}
        </h2>
        <p className="mt-1">
          {plan.auto ? (
            <>
              After the first, a wave goes <strong>by itself each morning</strong> (Monday to Saturday).
            </>
          ) : (
            <>
              Each wave goes <strong>only when someone presses the button</strong> on its email below; nothing goes out by itself.
            </>
          )}{" "}
          Never more than {n(plan.perDay)} a day in all (shared if more than one is going), so trouble shows up while it&apos;s small. Resend (our email service) is set to{" "}
          {n(plan.daily)} a day and {n(plan.monthly)} a month; {n(plan.reserve)} a day are kept for receipts, tickets and the daily report.
        </p>
        <p className="mt-1 text-[var(--muted)]">
          Today: {n(plan.usedToday)} of {n(plan.perDay)} used ({n(plan.todayLeft)} left). This month: {n(plan.usedMonth)} of {n(plan.perMonth)}.
        </p>
        {isAdmin && <WaveMode plan={plan} />}
        {isAdmin && <WaveSize plan={plan} />}
        {isAdmin && <PlanEditor plan={plan} />}
      </section>

      {cards.map((c) => (
        <Card
          key={c.key}
          card={c}
          plan={plan}
          blocker={blocker}
          canTest={!testBlocker}
          testBlocker={testBlocker}
          myEmail={myEmail}
          isSender={sender.ok}
          senderNames={sender.names}
        />
      ))}
    </div>
  );
}
