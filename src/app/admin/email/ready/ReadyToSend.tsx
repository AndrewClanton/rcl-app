"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AudienceCount, DesignResults } from "@/lib/email/designs/ready";
import type { DesignKey } from "@/lib/email/designs/types";
import { pauseDesign, resumeDesign, saveResendPlan, sendDesign, sendDesignTest } from "./actions";

// The Ready to send screen: the three ready-made emails as cards. Each has
// its preview (desktop, phone, plain text), who it would go to right now,
// "Send me a test", "Send to N people" (with a confirm step), and how it
// did. The words on the screen are for staff who've never sent an email
// campaign: plain, and nothing to configure.

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
  campaignId: string | null;
  results: DesignResults | null;
  outcomeLabel: string;
  outcomeAbout: string;
  sendKey: string; // a fresh one each time the page loads: a double click reuses it
}

export interface PlanData {
  daily: number;
  monthly: number;
  reserve: number;
  perDay: number;
  perMonth: number;
  usedToday: number;
  usedMonth: number;
  todayLeft: number;
  monthLeft: number;
}

const n = (x: number) => x.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const people = (x: number) => `${n(x)} ${x === 1 ? "person" : "people"}`;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-[var(--muted)]">{sub}</div> : null}
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

function Card({ card, plan, canSend, canTest, blockedWhy, myEmail }: { card: CardData; plan: PlanData; canSend: boolean; canTest: boolean; blockedWhy: string | null; myEmail: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const count = card.count?.willSend ?? 0;
  const going = card.status === "scheduled" || card.status === "sending";
  const paused = card.status === "paused";
  const r = card.results;
  const run = (what: string, fn: () => Promise<{ ok: boolean; text: string }>) =>
    start(async () => {
      setMsg({ ok: true, text: `${what}…` });
      const out = await fn().catch(() => ({ ok: false, text: "Couldn't reach the server. Check the connection and try again." }));
      setMsg(out);
      router.refresh();
    });

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
                <div className="text-xs text-[var(--muted)]">{card.campaignId ? "haven't had it yet and would get it today" : "would get it today"}</div>
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
                {card.count.noPhone > 0 && (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {people(card.count.noPhone)} with no login also have no phone on file, so they&apos;re left out: the &ldquo;Set my password&rdquo; page checks the last 4 digits of their phone. The door tablet or the register can sign them up in person.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-[var(--danger-text)]">Couldn&apos;t count them just now. Reload the page.</p>
            )}
          </div>

          {(going || paused || card.status === "sent") && r && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{going ? "Going out now, in daily waves" : paused ? "Paused" : "Sent"}</div>
              <p className="mt-1">
                {n(r.sent)} sent so far{going || paused ? `, ${n(count + r.waiting)} to go` : ""}.
              </p>
              {card.note && (going || paused) && <p className="mt-1 text-xs text-[var(--muted)]">{card.note}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary !px-4 !py-2 text-sm"
              disabled={pending || !canTest}
              title={canTest ? `Sends this email to ${myEmail}` : "Sending is switched off. Ask Andrew."}
              onClick={() =>
                run("Sending your test", async () => {
                  const out = await sendDesignTest(card.key);
                  return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                })
              }
            >
              Send me a test
            </button>
            {paused ? (
              <button
                type="button"
                className="btn-primary !px-4 !py-2 text-sm"
                disabled={pending || !canSend}
                onClick={() =>
                  run("Carrying on", async () => {
                    const out = await resumeDesign(card.key);
                    return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                  })
                }
              >
                Carry on sending
              </button>
            ) : going ? (
              <button
                type="button"
                className="btn-secondary !px-4 !py-2 text-sm"
                disabled={pending}
                onClick={() =>
                  run("Pausing", async () => {
                    const out = await pauseDesign(card.key);
                    return out.ok ? { ok: true, text: "Paused. Nothing more goes until you press Carry on sending." } : { ok: false, text: out.error };
                  })
                }
              >
                Pause
              </button>
            ) : (
              <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={pending || !canSend || count === 0} title={canSend ? undefined : (blockedWhy ?? undefined)} onClick={() => setConfirm(true)}>
                {count === 0 ? "Nobody to send it to" : `Send to ${people(count)}`}
              </button>
            )}
          </div>
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

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby={`confirm-${card.key}`}>
          <div className="card w-full max-w-md shadow-2xl">
            <h3 id={`confirm-${card.key}`} className="text-lg font-semibold">
              Send &ldquo;{card.title}&rdquo; to {people(count)}?
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted)]">Who</dt>
                <dd>{card.who}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">How many</dt>
                <dd>
                  {people(count)} right now. Anyone who joins the list before their wave goes gets it too; anyone who no longer fits (signed up meanwhile, turned email off) is skipped.
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">How it goes out</dt>
                <dd>
                  Up to {n(plan.perDay)} a day ({n(plan.todayLeft)} left today), so about {card.days ?? "?"} sending {card.days === 1 ? "day" : "days"}
                  {card.finish ? `, finishing around ${card.finish}` : ""}. Never on Sundays, only 9 AM to 7 PM.
                  {card.overMonth ? ` That's more than this month's ${n(plan.monthLeft)} left on our email plan, so the rest wait for next month.` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Subject</dt>
                <dd>{card.subject}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-[var(--muted)]">The first wave goes now and can&apos;t be taken back. You can pause the rest at any time.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setConfirm(false);
                  run("Sending the first wave", async () => {
                    const out = await sendDesign(card.key, card.sendKey);
                    return out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error };
                  });
                }}
              >
                Send to {people(count)}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
  stopped,
  picturesReady,
  countsFailed,
  plan,
  isAdmin,
  myEmail,
}: {
  cards: CardData[];
  sendingOn: boolean;
  offReason: string | null;
  stopped: string | null;
  picturesReady: boolean;
  countsFailed: boolean;
  plan: PlanData;
  isAdmin: boolean;
  myEmail: string;
}) {
  const blockedWhy = !sendingOn ? "Sending is switched off. Ask Andrew." : stopped ? "Sending is stopped. Ask Andrew." : !picturesReady ? "The pictures aren't on our server yet. Ask Andrew." : null;
  return (
    <div className="space-y-6">
      {!sendingOn && (
        <div className="notice notice-warn text-sm">
          <p>
            <strong>Sending is switched off — ask Andrew.</strong> Nothing goes out while it&apos;s off: not these emails, not tests. You can still look at each one and see
            who it would go to.
          </p>
          {isAdmin && offReason ? <p className="mt-1 text-xs">For Andrew: {offReason}</p> : null}
        </div>
      )}
      {stopped && (
        <div className="notice notice-warn text-sm">
          <strong>Sending is stopped right now.</strong> {stopped} Ask Andrew before sending anything.
        </div>
      )}
      {!picturesReady && (
        <div className="notice notice-warn text-sm">
          <strong>The pictures for these emails aren&apos;t on our server yet,</strong> so they can&apos;t go out (the previews below may show broken pictures). Ask Andrew: it&apos;s a
          one-time upload.
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
            <strong>Send.</strong> &ldquo;Send to N people&rdquo; shows exactly who and how many, and asks you to confirm. Each person gets it once, with their own
            first name and their own button. Our email plan only allows {plan.daily} emails a day, so it goes out in daily waves of up to {plan.perDay}, every morning
            (Monday to Saturday) until everyone has it. You can pause it any time.
          </li>
          <li>
            <strong>Read the results.</strong> <em>Delivered</em> reached their inbox. <em>Opened</em> is rough (some phones open every email by themselves).{" "}
            <em>Clicked</em> tapped something. The number that matters is the last one: who <em>signed in</em> (the first two emails) or <em>set up Insiders+</em> (the
            third) since it went.
          </li>
        </ol>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Nobody who turned email off, unsubscribed, or whose address bounced ever gets these. Every email has an unsubscribe link and our street address at the bottom.
        </p>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <h2 className="font-semibold">Our email plan</h2>
        <p className="mt-1">
          Resend (our email service) allows {n(plan.daily)} emails a day and {n(plan.monthly)} a month on our plan. {n(plan.reserve)} a day are kept for receipts, tickets and
          the daily report, so these go out up to <strong>{n(plan.perDay)} a day</strong>.
        </p>
        <p className="mt-1 text-[var(--muted)]">
          Today: {n(plan.usedToday)} of {n(plan.perDay)} used ({n(plan.todayLeft)} left). This month: {n(plan.usedMonth)} of {n(plan.perMonth)}.
        </p>
        {isAdmin && <PlanEditor plan={plan} />}
      </section>

      {cards.map((c) => (
        <Card key={c.key} card={c} plan={plan} canSend={!blockedWhy} canTest={sendingOn && !stopped} blockedWhy={blockedWhy} myEmail={myEmail} />
      ))}
    </div>
  );
}
