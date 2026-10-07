"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AudienceCount, DesignResults, WaveResult } from "@/lib/email/designs/ready";
import type { DesignKey } from "@/lib/email/designs/types";
import { UNDO_STOP_BEFORE_MS } from "@/lib/email/undo";
import { StatusChip, type ChipTone } from "../_studio/ui";
import { finishEveryone, pauseDesign, resumeDesign, sendDesign, sendDesignTest, sendNextWave } from "./actions";

// The Ready to send screen: the three ready-made emails as cards, each in
// four steps (Royale Email Studio): Look it over, Try it on your phone,
// Send, Watch, then carry on. The rail shows where the email really
// is, and opens each step; what matters whatever the step (the brake, the
// Undo bar, Pause and Carry on, how far it's got) stays above them. Each
// card has its preview (phone, computer, plain text), who it would go to
// right now, "Send me a test", "Send to N people" (with a confirm step),
// and how it did, overall and wave by wave (daily waves, most engaged
// first, so wave 1 can be judged before wave 2). The words are for staff
// who've never sent an email campaign: plain, and nothing to configure
// (admins set the wave size and the plan's numbers in Email, Settings).

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
  // If pressed now, the next wave waits at Resend so it can be undone: in
  // about `minutes`, or (held overnight) at `label`. Null: no Undo for it
  // (too big to call back in time, Saturday evening, or Resend won't hold email).
  hold: { minutes: number; label: string } | null;
  nextWaveOn: string | null; // a wave went today: the next can go "tomorrow" ("Monday")
  lastTest: { who: string; when: string } | null; // the last test of it ("You", "today 2:14 PM"), from _studio/tests-log
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
  everyone: boolean; // "Send to everyone now": nothing has left yet; it starts going out at `arrives`
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
  cap: number; // the most member email in one day (Email, Settings)
  everyoneToday: number; // how many "Send to everyone now" could reach right now (0 outside sending hours)
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
    <Link href={b.href} className="btn-secondary inline-flex min-h-11 items-center !px-3 !py-1 text-xs">
      {b.label ?? "Go there"}
    </Link>
  ) : null;
}

const SPACED_DAYS = 3;

// The browser's clock, a few times a second. The countdown adds the
// difference from the server's clock (it's the one that decides whether
// the minute is up), worked out when the page arrives, before the first tick.
const subscribeClock = (cb: () => void) => {
  const id = setInterval(cb, 250);
  return () => clearInterval(id);
};
const getTick = () => Math.floor(Date.now() / 250);
const getZero = () => 0;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// "Wave 2 is on its way to 80 people. Undo (0:59)", then "On its way.
// Arrives about 5:12 PM." until it's due.
function UndoBar({ undo, status, busy, offset, onUndo }: { undo: UndoCard; status: string | null; busy: boolean; offset: number; onUndo: () => void }) {
  const tick = useSyncExternalStore(subscribeClock, getTick, getZero);
  // Nothing time-dependent on the server's render (no flash of the wrong time).
  if (!tick) return null;
  const now = tick * 250 + offset;
  const left = Math.max(0, Math.ceil((undo.until - now) / 1000));
  const canUndo = left > 0 || (undo.started && now < undo.arrives - UNDO_STOP_BEFORE_MS);
  const onItsWay = status === "scheduled" || status === "sending" || status === "sent";
  if (!canUndo) {
    if (!onItsWay || now >= undo.arrives) return null;
    return (
      <p className="rounded-xl bg-[var(--foreground)] px-4 py-3 text-sm text-[var(--background)]" role="status">
        {undo.everyone ? (
          <>
            <strong>Going to {people(undo.people)} at {undo.arrivesLabel}.</strong> The minute to undo is over; Pause still stops what hasn&apos;t gone.
          </>
        ) : (
          <>
            <strong>Wave {undo.wave} is on its way.</strong> Arrives about {undo.arrivesLabel}.
          </>
        )}
      </p>
    );
  }
  const what = undo.everyone && !undo.undoing && !undo.started && status !== "paused"
    ? `Going to everyone: ${people(undo.people)} at ${undo.arrivesLabel}.`
    : undo.undoing
    ? `Calling back wave ${undo.wave}…`
    : undo.started
      ? `Wave ${undo.wave} isn't all called back yet.`
      : status === "paused"
        ? `Wave ${undo.wave} (${people(undo.people)}) is paused.`
        : `Wave ${undo.wave} is on its way to ${people(undo.people)}.`;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--foreground)] px-4 py-3 text-sm text-[var(--background)]">
      <p className="min-w-0 flex-1 basis-56" role="status">
        <strong>{what}</strong>{" "}
        <span className="text-[#d9d2bf]">
          {undo.started
            ? `Press Undo to finish calling it back before ${undo.arrivesLabel}.`
            : undo.everyone
              ? "Nothing has left yet. Undo stops all of it."
              : `It arrives about ${undo.arrivesLabel}. Undo calls back every one of them.`}
        </span>
      </p>
      <button
        type="button"
        className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-lg border-2 border-[var(--gold)] px-5 text-base font-bold tabular-nums text-[var(--gold)] transition-colors hover:bg-[var(--gold)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={onUndo}
      >
        {busy ? "Calling back…" : left > 0 ? `Undo (${mmss(left)})` : "Undo"}
      </button>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--background)] p-3.5">
      <div className="text-[13px] text-[var(--muted)]">{label}</div>
      <div className="font-display text-xl tabular-nums sm:text-2xl">{value}</div>
      {sub ? <div className="text-xs text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

const waveDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Each wave's results, so wave 1 can be judged before wave 2 goes.
function Waves({ waves, outcomeLabel, id }: { waves: WaveResult[]; outcomeLabel: string; id: string }) {
  const cell = (a: number, b: number) => (
    <>
      {n(a)} <span className="text-[var(--muted)]">{pct(a, b)}</span>
    </>
  );
  return (
    <div className="space-y-2">
      <h4 id={id} className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        Wave by wave
      </h4>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]" role="region" aria-labelledby={id} tabIndex={0}>
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

const chipCls = (on: boolean) => `chip inline-flex min-h-11 items-center !px-3 !text-xs ${on ? "chip-selected" : ""}`;

// The email as members see it: on a phone (in a phone's frame, the email
// at 375 wide shown at 80%), on a computer (620 wide, across the card) or
// as plain text, with or without a website login.
function Preview({ card }: { card: CardData }) {
  const [view, setView] = useState<"desktop" | "phone" | "text">("phone");
  const [as, setAs] = useState<"claim" | "login">("claim");
  const html = as === "login" && card.loginHtml ? card.loginHtml : card.desktopHtml;
  return (
    <aside aria-label={`${card.title} as members see it`} className={`min-w-0 space-y-3 ${view === "phone" ? "" : "lg:col-span-full"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {(["phone", "desktop", "text"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} className={chipCls(view === v)} onClick={() => setView(v)}>
            {v === "desktop" ? "Computer" : v === "phone" ? "Phone" : "Plain text"}
          </button>
        ))}
      </div>
      {card.loginHtml && (
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={as === "claim"} className={chipCls(as === "claim")} onClick={() => setAs("claim")}>
            No website login yet
          </button>
          <button type="button" aria-pressed={as === "login"} className={chipCls(as === "login")} onClick={() => setAs("login")}>
            Already signed up
          </button>
        </div>
      )}
      {view === "text" ? (
        <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-white p-4 text-xs text-black">{card.text}</pre>
      ) : view === "phone" ? (
        <div className="mx-auto w-[316px] max-w-full rounded-[40px] bg-[var(--foreground)] p-2 shadow-[0_20px_44px_rgba(20,17,12,0.25)]">
          <div className="h-[600px] w-full overflow-hidden rounded-[32px] bg-[#14110c]">
            <iframe title={`${card.title} on a phone`} srcDoc={html} sandbox="" className="block h-[750px] w-[375px] origin-top-left scale-[0.8] bg-[#14110c]" />
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[#14110c]">
          <iframe title={`${card.title} on a computer`} srcDoc={html} sandbox="" className="mx-auto block h-[720px] bg-[#14110c]" style={{ width: 620, maxWidth: "none" }} />
        </div>
      )}
      <p className="text-center text-xs text-[var(--muted)]">
        Shown as it would look for a member named Sam. Each person sees their own first name, and their own button.
      </p>
    </aside>
  );
}

// ---------- the steps ----------
type StepState = "done" | "current" | "attention" | "todo" | "tip";
const STATE_WORD: Record<StepState, string> = { done: "done", current: "you're here", attention: "needs a look", todo: "not yet", tip: "suggested" };
const STEP_TITLES = ["Look it over", "Try it on your phone", "Send", "Watch, then carry on"] as const;

function Mark({ state, i }: { state: StepState; i: number }) {
  const cls =
    state === "done" || state === "current"
      ? "bg-[var(--foreground)] text-[var(--background)]"
      : state === "attention"
        ? "bg-[var(--accent-hover)] text-white"
        : state === "tip"
          ? "border-2 border-dashed border-[var(--muted)] text-[var(--foreground)]"
          : "bg-[var(--border)] text-[#4a4336]";
  return (
    <span aria-hidden="true" className={`inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-sm font-bold ${cls}`}>
      {state === "done" ? "✓" : state === "attention" ? "!" : i + 1}
    </span>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ok ? "var(--success-text)" : "var(--accent-hover)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        {ok ? <path d="M7.5 12.5l3 3 6-6.5" /> : <path d="M12 7v6M12 16.5v.5" />}
      </svg>
      <span>
        <span className="sr-only">{ok ? "Checked: " : "Not yet: "}</span>
        {children}
      </span>
    </li>
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
  offset,
  picturesReady,
}: {
  card: CardData;
  plan: PlanData;
  blocker: Blocker | null;
  canTest: boolean;
  testBlocker: Blocker | null;
  myEmail: string;
  isSender: boolean;
  senderNames: string; // "Nathan and Mary"
  offset: number; // the server's clock less the browser's (ms)
  picturesReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Undo has its own, so nothing else running on the card holds it up.
  const [undoing, startUndo] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"first" | "next" | "everyone" | null>(null);
  const [checked, setChecked] = useState("");
  // The "On my phone" ticks: a checklist for whoever's testing, not saved.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
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
        : card.nextWaveOn
          ? `The next wave can go ${card.nextWaveOn}, once you've seen how this one did.`
          : plan.todayLeft <= 0
            ? `Today's share has gone. The next wave can go ${plan.nextWave}.`
            : allSpaced;
  const firstWhy = !canSend
    ? blockedWhy
    : card.nextWaveOn
      ? `It went out today. It can go again ${card.nextWaveOn}, once you've seen how it did.`
      : !plan.auto && plan.todayLeft <= 0
        ? `Today's share has gone. The first wave can go ${plan.nextWave}.`
        : allSpaced;
  // "Send to everyone now": everyone left except those kept apart, up to
  // what today's limit has room for.
  const allWant = Math.max(0, count - spacedTotal);
  const allN = Math.min(allWant, plan.everyoneToday);
  const allLater = allWant - allN;
  const everyoneWhy = !canSend
    ? blockedWhy
    : card.nextWaveOn
      ? `It went out today. It can go again ${card.nextWaveOn}, once you've seen how it did.`
      : waiting > 0
        ? "The last wave is still going out."
        : plan.goesAt !== "now"
          ? "Email only goes out 9 AM to 7 PM, Monday to Saturday."
          : plan.everyoneToday <= 0
            ? `Today's limit of ${n(plan.cap)} member emails has been reached. It can go tomorrow (not Sunday).`
            : allN === 0
              ? (allSpaced ?? "Everyone it's for has had it.")
              : null;
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
  // Undo goes to its own address (/api/email/undo), not a Server Action:
  // the browser sends those one at a time, and Undo mustn't wait behind
  // another.
  const undo = () => {
    const u = card.undo;
    if (!u || !card.campaignId) return;
    const body = JSON.stringify({ key: card.key, campaignId: card.campaignId, undoKey: u.key });
    startUndo(async () => {
      setMsg({ ok: true, text: "Calling back the wave…" });
      const res = await fetch("/api/email/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" }).catch(() => null);
      const out = ((await res?.json().catch(() => null)) ?? null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!out) setMsg({ ok: false, text: "Couldn't reach the server. Press Undo again." });
      else setMsg(out.ok ? { ok: true, text: out.message ?? "Undone." } : { ok: false, text: out.error ?? "Couldn't undo it. Press Undo again." });
      router.refresh();
    });
  };
  // "Send to everyone now": when its minute is over, ask for the hand-over
  // (the press's own run does it too; whichever comes first sends it).
  const everyoneKey = card.undo?.everyone && !card.undo.started ? card.undo.key : null;
  const everyoneAt = card.undo?.arrives ?? 0;
  useEffect(() => {
    if (!everyoneKey) return;
    const wait = Math.max(0, everyoneAt - (Date.now() + offset)) + 1500;
    const t = setTimeout(() => {
      void finishEveryone(card.key, everyoneKey)
        .then((out) => setMsg(out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error }))
        .catch(() => null)
        .finally(() => router.refresh());
    }, wait);
    return () => clearTimeout(t);
  }, [everyoneKey, everyoneAt, offset, card.key, router]);
  const firstLabel = count === 0 ? "Nobody to send it to" : plan.auto || count <= next.n ? `Send to ${people(count)}` : `Send the first ${n(next.n)} (of ${n(count)})`;
  const nextLabel = `Send the next ${n(Math.min(next.n, count) || plan.perDay)}`;
  const waveLine = paused
    ? plan.auto
      ? "paused: the next wave goes when you press Carry on sending"
      : "paused: press Carry on sending, then Send the next wave"
    : left === 0
      ? "the last wave has gone"
      : plan.auto
        ? `next wave ${card.nextWaveOn ?? plan.nextWave}`
        : waiting > 0
          ? "this wave is still going out"
          : card.nextWaveOn
            ? `next wave can go ${card.nextWaveOn}`
            : plan.todayLeft > 0
              ? `next wave when you press ${nextLabel}`
              : `next wave can go ${plan.nextWave}`;

  // Where it really is, step by step (the rail), from the same facts.
  const waves = r?.waves ?? [];
  const started = going || paused || card.status === "sent";
  const firstWave = waves[0] ?? null;
  const footerOk = card.text.includes("Unsubscribe:") && card.text.includes("715 E Broadway");
  const raw: { sub: string; state: "done" | "attention" | "tip" | "open" }[] = [
    picturesReady ? { sub: "Checked for you", state: "done" } : { sub: "The pictures aren't up yet", state: "attention" },
    card.lastTest ? { sub: `${card.lastTest.who}, ${card.lastTest.when}`, state: "done" } : started ? { sub: "No test on record", state: "tip" } : { sub: "A test to your inbox", state: "open" },
    started && firstWave ? { sub: `Wave 1: ${n(firstWave.sent)} on ${waveDay(firstWave.day)}`, state: "done" } : { sub: "Everyone now, or in waves", state: "open" },
    paused && card.brake
      ? { sub: "The brake stopped it", state: "attention" }
      : going || paused
        ? { sub: paused ? "Paused" : `Wave ${Math.max(1, waves.length)} · ${n(left)} to go`, state: "open" }
        : card.status === "sent"
          ? { sub: count > 0 ? `All sent · ${n(count)} new since` : "Everyone it's for has it", state: "done" }
          : { sub: `${n(plan.perDay)} a day after that`, state: "open" },
  ];
  const firstOpen = raw.findIndex((s) => s.state === "open" || s.state === "attention");
  const steps = raw.map((s, i) => ({ title: STEP_TITLES[i], sub: s.sub, state: (s.state === "open" ? (i === firstOpen ? "current" : "todo") : s.state) as StepState }));
  // Opens on the step it's really at (the results once it's all gone); a
  // step picked on the rail holds until the email moves on (sent, a new
  // wave, an Undo), then the rail follows it again.
  const here = firstOpen >= 0 ? firstOpen : 3;
  const phase = `${card.status}:${waves.length}:${card.undo?.key ?? ""}`;
  const [pick, setPick] = useState<{ step: number; phase: string } | null>(null);
  const shown = pick && pick.phase === phase ? pick.step : here;
  const go = (step: number) => setPick({ step, phase });
  const panelId = `${card.key}-step`;

  const chip: { label: string; tone: ChipTone } = paused
    ? card.brake
      ? { label: "Brake on", tone: "stopped" }
      : { label: "Paused", tone: "paused" }
    : going
      ? { label: `Wave ${Math.max(1, waves.length)}`, tone: "going" }
      : card.status === "sent"
        ? { label: "Sent", tone: "sent" }
        : { label: "Ready", tone: "ready" };

  return (
    <section id={card.key} aria-labelledby={`${card.key}-title`} className="scroll-mt-4 rounded-[20px] border border-[var(--border)] p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id={`${card.key}-title`} className="font-display text-[28px] leading-tight sm:text-[34px]">
            {card.title}
          </h2>
          <p className="text-[15px] text-[var(--muted)]">{card.about}</p>
          <p className="mt-1 text-[15px]">
            {going || paused
              ? `${n(r?.sent ?? 0)} sent so far, ${n(left)} to go`
              : card.status === "sent"
                ? `Sent to ${n(r?.sent ?? 0)}${count > 0 ? ` · ${people(count)} new since could get it` : ""}`
                : card.count
                  ? `For ${people(count)} right now`
                  : null}
          </p>
        </div>
        <StatusChip label={chip.label} tone={chip.tone} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_316px] 2xl:grid-cols-[220px_minmax(0,1fr)_316px]">
        <nav aria-label={`Steps for ${card.title}`} className="lg:col-span-2 2xl:col-span-1">
          <ol className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 2xl:grid-cols-1">
            {steps.map((s, i) => (
              <li key={s.title} className="min-w-0" aria-current={s.state === "current" || s.state === "attention" ? "step" : undefined}>
                <button
                  type="button"
                  aria-pressed={shown === i}
                  aria-controls={panelId}
                  onClick={() => go(i)}
                  className={`flex min-h-11 w-full items-start gap-3 rounded-xl border-2 p-3 text-left ${shown === i ? "border-[var(--foreground)] bg-[var(--surface)]" : "border-transparent hover:bg-[var(--surface-hover)]"}`}
                >
                  <Mark state={s.state} i={i} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-bold leading-tight">{s.title}</span>
                    <span className="text-[13px] text-[var(--muted)]">
                      <span className="sr-only">{STATE_WORD[s.state]}: </span>
                      {s.sub}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          {/* Whatever the step: the brake, how far it's got, Undo, Pause and Carry on. */}
          {paused && card.brake && (
            <div className="space-y-2 rounded-xl border-2 border-[var(--accent-hover)] bg-[var(--background)] p-4 text-sm" role="alert">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-hover)]">Stopped by the automatic brake</div>
              <p className="font-semibold text-[var(--accent-hover)]">{card.brake}</p>
              <p className="text-xs text-[var(--muted)]">
                Nothing more of this email goes until someone carries on. Look at who bounced or complained (More detail, below): old or mistyped addresses, or
                people who never asked for email. Bounced addresses are already on the never-mail list, so they won&apos;t be sent to again.
              </p>
              {isSender ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input min-h-11 !w-auto min-w-0 flex-1 basis-56 text-sm"
                    placeholder="What you checked (required)"
                    value={checked}
                    onChange={(e) => setChecked(e.target.value)}
                    aria-label="What you checked"
                  />
                  <button type="button" className="btn-send" disabled={pending || !canSend || checked.trim().length < 5} title={blockedWhy ?? undefined} onClick={resume}>
                    I&apos;ve checked: carry on
                  </button>
                </div>
              ) : (
                <p className="text-xs">{senderNames || "Whoever sends email"} can carry on here once they&apos;ve checked the list.</p>
              )}
            </div>
          )}

          {(going || paused || card.status === "sent") && r && (
            <div className="rounded-xl bg-[var(--background)] p-4 text-sm">
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

          {card.undo && <UndoBar undo={card.undo} status={card.status} busy={undoing} offset={offset} onUndo={undo} />}

          {(paused || going) && (
            <div className="flex flex-wrap gap-2">
              {paused ? (
                <>
                  {!card.brake && (
                    <button type="button" className="btn-send" disabled={pending || !canSend} title={blockedWhy ?? undefined} onClick={resume}>
                      Carry on sending
                    </button>
                  )}
                  {card.atResend > 0 && (
                    <button type="button" className="btn-secondary min-h-11 !px-4 !py-2 text-sm" disabled={pending} onClick={() => pause("Calling back")}>
                      Call back the {n(card.atResend)} still waiting at Resend
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="btn-secondary min-h-11 !px-5 !py-2 text-sm"
                  disabled={pending}
                  title={card.atResend > 0 ? `Also calls back the ${n(card.atResend)} handed to Resend that haven't arrived yet` : undefined}
                  onClick={() => pause("Pausing")}
                >
                  Pause
                </button>
              )}
            </div>
          )}
          {paused && !card.brake && !canSend && blockedWhy && <p className="text-xs text-[var(--muted)]">{blockedWhy}</p>}
          {msg && (
            <p className={`text-sm ${msg.ok ? "" : "text-[var(--danger-text)]"}`} role="status">
              {msg.text}
            </p>
          )}

          <div id={panelId} className="space-y-5 border-t border-[var(--border)] pt-5 first:border-t-0 first:pt-0">
            <h3 className="font-display text-2xl sm:text-[28px]">{STEP_TITLES[shown]}</h3>

            {shown === 0 && (
              <>
                <p className="text-[#4a4336]">This is how it lands in their inbox. We already checked the things that usually go wrong.</p>
                <div className="rounded-xl bg-[var(--background)] p-4 text-sm">
                  <div className="text-xs text-[var(--muted)]">In their inbox</div>
                  <div className="mt-1">
                    <strong>{card.subject}</strong> <span className="text-[var(--muted)]">— {card.preheader}</span>
                  </div>
                </div>
                <ul className="list-none space-y-3 p-0">
                  <Check ok={picturesReady}>The pictures are on our picture server{picturesReady ? "" : " (not yet: see the go-live checklist in Settings)"}</Check>
                  <Check ok={footerOk}>The unsubscribe link and our street address are at the bottom</Check>
                  <Check ok={card.text.trim().length > 0}>There&apos;s a plain-text version for mail apps without pictures</Check>
                  <Check ok>Each person sees their own first name, and their own button</Check>
                  <Check ok>Nobody who turned email off, unsubscribed, or whose address bounced ever gets it</Check>
                </ul>
                <div className="rounded-xl bg-[var(--background)] p-4 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Who gets it</div>
                  <p className="mt-1">{card.who}</p>
                  {card.count ? (
                    <>
                      <div className="mt-2 font-display text-2xl tabular-nums">{people(count)}</div>
                      <div className="text-xs text-[var(--muted)]">{card.campaignId ? "haven't had it yet and would get it" : "would get it"}</div>
                      {spaced.map((s) => (
                        <p key={s.title} className="mt-1 text-xs">
                          {n(s.n)} of them got <em>{s.title}</em> in the last {SPACED_DAYS} days, so they&apos;ll get this one in a later wave.
                        </p>
                      ))}
                      {card.count.excluded.length > 0 && (
                        <details className="mt-2 text-xs">
                          <summary className="flex min-h-11 cursor-pointer items-center text-[var(--muted)]">Who&apos;s left out, and why</summary>
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
                <button type="button" className="btn-ink" onClick={() => go(1)}>
                  Next: send me a test
                </button>
              </>
            )}

            {shown === 1 && (
              <>
                <p className="text-[#4a4336]">
                  &ldquo;Send me a test&rdquo; sends it to your own inbox ({myEmail}) with your name in it. Open it on your phone and tap around. Tests never go to members.
                  In a test, the main button opens the ordinary sign-in or membership page, not anyone&apos;s own link.
                </p>
                {card.lastTest && (
                  <p className="text-sm">
                    Last test: <strong>{card.lastTest.who}</strong>, {card.lastTest.when}.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary min-h-11 !px-5 !py-2 text-sm"
                    disabled={pending || !canTest}
                    title={canTest ? `Sends this email to ${myEmail}` : (testBlocker?.text ?? undefined)}
                    onClick={() =>
                      run("Sending your test", async () => {
                        const out = await sendDesignTest(card.key);
                        return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                      })
                    }
                  >
                    {card.lastTest?.who === "You" ? "Send me another" : "Send me a test"}
                  </button>
                  {!canTest && testBlocker && <span className="text-xs text-[var(--muted)]">{testBlocker.text}</span>}
                </div>
                <fieldset className="space-y-1 rounded-xl border border-[var(--border)] p-4">
                  <legend className="px-1.5 font-bold">On my phone</legend>
                  {[
                    ["pictures", "The pictures and my name look right"],
                    ["button", "The big button opened the website"],
                    ["words", "The words read well"],
                    ["unsubscribe", "Unsubscribe at the bottom works (then switch your email back on)"],
                  ].map(([k, label]) => (
                    <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input type="checkbox" className="h-[22px] w-[22px] shrink-0 accent-[var(--foreground)]" checked={!!ticks[k]} onChange={(e) => setTicks((t) => ({ ...t, [k]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                  <p className="pt-1 text-xs text-[var(--muted)]">Just for you while you look: these ticks aren&apos;t saved.</p>
                </fieldset>
                <button type="button" className="btn-ink" onClick={() => go(2)}>
                  Looks good: next
                </button>
              </>
            )}

            {shown === 2 && (
              <>
                <p className="text-[#4a4336]">The members most used to hearing from us get it first. Everyone else waits until you&apos;ve seen how these did.</p>
                {card.count && count > 0 && (
                  <div className="rounded-xl bg-[var(--background)] p-4 text-sm">
                    <div className="font-bold">Who&apos;s {going || paused ? "next" : "first"}</div>
                    <p>
                      {n(Math.min(next.n, count))} of the {people(count)} {card.campaignId ? "left" : "it's for"}, the most engaged first:
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {next.mix.map((g) => (
                        <li key={g.label} className="flex justify-between gap-3">
                          <span>{g.label}</span>
                          <span className="tabular-nums">{n(g.n)}</span>
                        </li>
                      ))}
                    </ul>
                    {spaced.map((s) => (
                      <p key={s.title} className="mt-1 text-xs">
                        {n(s.n)} of these got <em>{s.title}</em> in the last {SPACED_DAYS} days. They&apos;ll get this one later.
                      </p>
                    ))}
                  </div>
                )}
                {!going && !paused && card.count && count > 0 && (
                  <p className="text-sm text-[var(--muted)]">
                    Goes out in waves, the members most used to hearing from us first: the first wave to {n(Math.min(next.n || plan.firstWave, count))}
                    {count > (next.n || plan.firstWave) ? `, then ${n(plan.perDay)} at a time` : ""}.{" "}
                    {plan.auto
                      ? "After the first, one goes each morning (Monday to Saturday); check how wave 1 did, and Pause if something's wrong."
                      : "After the first, each wave goes only when someone presses Send the next wave here, so check how the last one did first."}
                  </p>
                )}
                {going || paused ? (
                  <div className="space-y-2">
                    <p className="text-sm">It&apos;s already going out. See how the last wave did, then carry on from Watch, then carry on.</p>
                    <button type="button" className="btn-ink" onClick={() => go(3)}>
                      See how it&apos;s doing
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="How to send it">
                    <div className="flex flex-col gap-2 rounded-xl border-2 border-[var(--border)] p-3">
                      <button type="button" className="btn-send !min-h-[56px] w-full !px-5 !text-lg" disabled={pending || !!everyoneWhy} title={everyoneWhy ?? undefined} onClick={() => setConfirm("everyone")}>
                        Send to everyone now ({people(allN)})
                      </button>
                      <span className="text-sm text-[var(--muted)]">
                        {everyoneWhy ?? `All at once, after a minute to undo.${allLater > 0 ? ` ${n(allLater)} more go another day (today's limit is ${n(plan.cap)}).` : ""}`}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 rounded-xl border-2 border-[var(--border)] p-3">
                      <button type="button" className="btn-secondary !min-h-[56px] w-full !px-5 !text-lg" disabled={pending || !!firstWhy || count === 0} title={firstWhy ?? undefined} onClick={() => setConfirm("first")}>
                        Send in waves
                      </button>
                      <span className="text-sm text-[var(--muted)]">
                        {firstWhy ?? (count > 0 ? `${firstLabel}, then ${n(plan.perDay)} at a time. ${card.hold ? "A minute to undo each wave." : "Pause stops the rest at any time."}` : "Nobody to send it to.")}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {shown === 3 && (
              <>
                {going && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
                    {!plan.auto && (
                      <button type="button" className="btn-send !min-h-[52px] !px-6 !text-base" disabled={pending || !!nextWhy} title={nextWhy ?? undefined} onClick={() => setConfirm("next")}>
                        {nextLabel}
                      </button>
                    )}
                    <button type="button" className="btn-secondary !min-h-[52px] !px-6 !text-base" disabled={pending || !!everyoneWhy} title={everyoneWhy ?? undefined} onClick={() => setConfirm("everyone")}>
                      Send the rest now ({people(allN)})
                    </button>
                  </div>
                )}
                {going && (nextWhy || everyoneWhy) && <p className="text-xs text-[var(--muted)]">{plan.auto ? everyoneWhy : (nextWhy ?? everyoneWhy)}</p>}
                {r && r.sent > 0 ? (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">How it did</h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Stat label="Sent" value={n(r.sent)} sub={r.waiting ? `${n(r.waiting)} waiting to go` : undefined} />
                      <Stat label="Delivered" value={n(r.delivered)} sub={pct(r.delivered, r.sent)} />
                      <Stat label="Opened (rough)" value={n(r.opened)} sub={pct(r.opened, r.delivered)} />
                      <Stat label="Clicked" value={n(r.clicked)} sub={pct(r.clicked, r.delivered)} />
                      <Stat label={card.outcomeLabel} value={n(r.outcome)} sub={`of ${n(r.outcomeOf)} · ${card.outcomeAbout.toLowerCase()}`} />
                      <Stat label="Unsubscribed · bounced" value={`${n(r.unsubscribed)} · ${n(r.bounced)}`} />
                    </div>
                    <p className="text-sm text-[#4a4336]">
                      Good signs: people tapping a link, and nobody marking it as spam. If a wave has trouble (unsubscribes, bounces, or nobody clicking), don&apos;t send
                      the next one: press Pause. Results keep coming in for a day or two.
                    </p>
                    {card.campaignId && (
                      <Link href={`/admin/email/${card.campaignId}`} className="inline-flex min-h-11 items-center text-sm underline">
                        More detail (links clicked, who it didn&apos;t go to)
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="text-[#4a4336]">Nothing has gone yet. Once the first wave goes, how it did shows here, wave by wave, before the next one can go.</p>
                )}
                {r && r.waves.length > 0 && <Waves waves={r.waves} outcomeLabel={card.outcomeLabel} id={`${card.key}-waves`} />}
              </>
            )}
          </div>
        </div>

        <Preview card={card} />
      </div>

      {confirm === "everyone" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={`confirm-${card.key}`}>
          <div className="card max-h-[90dvh] w-full max-w-md overflow-y-auto shadow-2xl">
            <h3 id={`confirm-${card.key}`} className="text-lg font-semibold">
              {going ? `Send the rest of “${card.title}” now?` : `Send “${card.title}” to everyone now?`}
            </h3>
            <p className="mt-2 text-3xl font-bold tabular-nums">{people(allN)}</p>
            <dl className="mt-3 space-y-2 text-sm">
              {allLater > 0 && (
                <div>
                  <dt className="text-xs text-[var(--muted)]">Not today</dt>
                  <dd>
                    {n(allLater)} more go another day: today&apos;s limit is {n(plan.cap)} member emails.
                  </dd>
                </div>
              )}
              {spaced.length > 0 && (
                <div>
                  <dt className="text-xs text-[var(--muted)]">Kept apart (at least {SPACED_DAYS} days between these emails)</dt>
                  <dd className="space-y-0.5">
                    {spaced.map((s) => (
                      <p key={s.title}>
                        {n(s.n)} got <em>{s.title}</em> in the last {SPACED_DAYS} days. They&apos;ll get this one later.
                      </p>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-[var(--muted)]">When</dt>
                <dd>Starts in about 2 minutes, then goes out in a few minutes, 100 at a time.</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Subject</dt>
                <dd>{card.subject}</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-lg bg-[var(--gold)]/15 p-3 text-sm">
              <strong>This can&apos;t be spread out once started. Undo works for 1 minute.</strong> If too many bounce or anyone marks it as spam, the rest stop by
              themselves.
            </p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary min-h-12" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-send min-h-12"
                onClick={() => {
                  setConfirm(null);
                  run("Sending to everyone", async () => {
                    const out = going ? await sendNextWave(card.key, card.sendKey, "everyone") : await sendDesign(card.key, card.sendKey, "everyone");
                    return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                  });
                }}
              >
                Send to {people(allN)} now
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && confirm !== "everyone" && (
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
                    : !card.hold
                      ? "Now."
                      : card.hold.minutes <= 15
                        ? `In about ${card.hold.minutes} minutes (it waits at Resend first, so it can be undone).`
                        : `It arrives about ${card.hold.label} (it waits at Resend so it can be undone, and email only goes out 9 AM to 7 PM, Monday to Saturday).`}{" "}
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
            {card.hold && (
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
              <button type="button" className="btn-secondary min-h-11" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-send"
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
  noHolds,
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
  noHolds: boolean; // Resend won't hold email for later: no Undo, email goes only when due
}) {
  // The server's clock less this browser's, worked out as the page arrives
  // (before the countdown's first tick). The two clocks don't drift apart
  // in a visit, so once is enough.
  const [clock] = useState(() => ({ offset: serverNow - Date.now() }));
  // Who can fix each thing, and where (no dead ends).
  const toSwitch = { href: "/admin/email/settings#sending", label: "Go to Sending on/off" };
  const offBlocker: Blocker | null = sendingOn
    ? null
    : offKind === "switch"
      ? { text: "Sending is switched off. An owner can turn it on in Email, Settings.", ...toSwitch }
      : offKind === "master"
        ? { text: "Sending is switched off at the top level (Vercel). An owner turns that on once, then uses the switch in Email, Settings.", ...toSwitch }
        : { text: `Sending isn't set up yet: ${offReason ?? "see the go-live checklist in Email, Settings."}`, href: "/admin/email/settings", label: "See the go-live checklist" };
  const senderBlocker: Blocker | null = sender.ok ? null : { text: sender.why ?? "Only the people picked to send email can send it to members.", href: "/admin/email/settings#senders", label: "See who sends" };
  const blocker: Blocker | null =
    senderBlocker ??
    offBlocker ??
    (stopped
      ? { text: "Sending is stopped. Someone who sends email can resume it on the Email page.", href: "/admin/email", label: "Go to the Email page" }
      : !picturesReady
        ? { text: "The pictures for these emails aren't on our picture server yet.", href: "/admin/email/settings", label: "See the go-live checklist" }
        : null);
  const testBlocker = offBlocker ?? (stopped ? blocker : null);
  return (
    <div className="space-y-6">
      {senderBlocker && (
        <div className="notice space-y-2 rounded-2xl text-sm">
          <p>{senderBlocker.text}</p>
          <BlockerLink b={senderBlocker} />
        </div>
      )}
      {offBlocker && (
        <div className="notice notice-warn space-y-2 rounded-2xl text-sm">
          <p>
            <strong>{offBlocker.text}</strong> Nothing goes out while it&apos;s off: not these emails, not tests. You can still look at each one and see who it would go to.
          </p>
          {isAdmin && offReason && offKind === "setup" ? <p className="text-xs">Why: {offReason}</p> : null}
          <BlockerLink b={offBlocker} />
        </div>
      )}
      {stopped && (
        <div className="space-y-2 rounded-2xl border-2 border-[var(--accent-hover)] bg-[var(--surface)] p-4 text-sm" role="alert">
          <p>
            <strong>Sending is stopped right now.</strong> {stopped} Someone who sends email can resume it on the Email page once they&apos;ve checked what happened.
          </p>
          <Link href="/admin/email" className="btn-secondary inline-flex min-h-11 items-center !px-3 !py-1 text-xs">
            Go to the Email page
          </Link>
        </div>
      )}
      {!picturesReady && (
        <div className="notice notice-warn space-y-2 rounded-2xl text-sm">
          <p>
            <strong>The pictures for these emails aren&apos;t on our picture server yet,</strong> so they can&apos;t go out (the previews below may show broken pictures). The
            go-live checklist in Email, Settings shows which are missing.
          </p>
          <Link href="/admin/email/settings" className="btn-secondary inline-flex min-h-11 items-center !px-3 !py-1 text-xs">
            See the go-live checklist
          </Link>
        </div>
      )}
      {countsFailed && <p className="notice notice-warn rounded-2xl text-sm">Couldn&apos;t count who each email would go to just now. Reload the page.</p>}
      {noHolds && (
        <p className="notice notice-warn rounded-2xl text-sm">
          There&apos;s no Undo just now: Resend wouldn&apos;t hold email to send later, so each wave goes as soon as it&apos;s pressed for. Pause still stops the rest.
        </p>
      )}

      <section className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <h2 className="font-bold">
          {plan.firstWave < plan.perDay ? `First wave ${n(plan.firstWave)}, then waves of ${n(plan.perDay)}` : `Waves of ${n(plan.perDay)}`} ·{" "}
          {!cards.some((c) => c.status === "scheduled" || c.status === "sending")
            ? "the first goes when you press Send"
            : plan.auto
              ? `next wave ${plan.nextWave}`
              : plan.todayLeft > 0
                ? "next wave when you press Send the next wave"
                : `next wave can go ${plan.nextWave}`}
        </h2>
        <p>
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
        <p className="text-[var(--muted)]">
          Today: {n(plan.usedToday)} of {n(plan.perDay)} used ({n(plan.todayLeft)} left). This month: {n(plan.usedMonth)} of {n(plan.perMonth)}. Emails called back with
          Undo still count, in case Resend counts them.
        </p>
        {noHolds && isAdmin && (
          <p className="text-xs text-[var(--warn-text)]">
            Resend sent at once (or refused) email it was asked to hold for later, so nothing is handed over before it&apos;s due and there&apos;s no Undo. Once
            that&apos;s sorted with Resend, a developer clears the &ldquo;resend_scheduling&rdquo; email setting to try again.
          </p>
        )}
        {isAdmin && (
          <Link href="/admin/email/settings" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
            Change the wave size, how waves go, or the plan&apos;s numbers in Settings
          </Link>
        )}
      </section>

      <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <summary className="flex min-h-11 cursor-pointer items-center font-bold">How this works</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            <strong>Look.</strong> Each email shows below as members will see it. Switch between <em>Phone</em> and <em>Computer</em>; <em>Plain text</em> is the version
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
            Or press <strong>Send to everyone now</strong>: everyone it&apos;s for (up to {n(plan.cap)} a day) in one go, after a minute to undo. The brake still
            stops the rest if too many bounce.{" "}
            {noHolds ? (
              <>
                There&apos;s no Undo just now: Resend wouldn&apos;t hold email to send later, so each wave goes as soon as it&apos;s pressed for. Pause still stops the rest.
              </>
            ) : (
              <>
                For one minute after you press Send (or Send the next wave), <strong>Undo</strong> calls the whole wave back before anyone gets it: a wave you send waits a
                few minutes at Resend first, just for this (waves that go by themselves don&apos;t).
              </>
            )}
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
      </details>

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
          offset={clock.offset}
          picturesReady={picturesReady}
        />
      ))}
    </div>
  );
}
