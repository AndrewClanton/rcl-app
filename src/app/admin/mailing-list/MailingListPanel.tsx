"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import { defaultLineupSubject, lineupEmailHtml, rangeLabel, type LineupData, type LineupEmail } from "@/lib/email/lineup-email";
import { loadLineup, sendLineupNow, sendLineupTest, syncMailingListNow } from "./actions";

export interface SyncRow {
  started_at: string;
  finished_at: string | null;
  complete: boolean;
  subscribers: number | null;
  added: number;
  removed: number;
  opted_out: number;
  errors: string | null;
}

export interface SendRow {
  id: string;
  subject: string;
  status: "sending" | "sent" | "failed";
  range_start: string | null;
  recipients: number | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  sender: { name: string } | null;
}

const DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7, 10, 14];

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MailingListPanel({
  sendKey,
  today,
  initialLineup,
  subscribers,
  lastSync,
  sends,
  connected,
  sender,
  webhookReady,
  myEmail,
  myFirstName,
}: {
  sendKey: string;
  today: string;
  initialLineup: LineupData;
  subscribers: number | null;
  lastSync: SyncRow | null;
  sends: SendRow[];
  connected: boolean;
  sender: { from: string | null; ready: boolean; problem: string | null };
  webhookReady: boolean;
  myEmail: string;
  myFirstName: string | null;
}) {
  const router = useRouter();
  const [start, setStart] = useState(initialLineup.rangeStart);
  const [days, setDays] = useState(initialLineup.rangeDays);
  const [lineup, setLineup] = useState<LineupData>(initialLineup);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipMovies, setSkipMovies] = useState<Set<string>>(new Set());
  const [skipHappenings, setSkipHappenings] = useState<Set<string>>(new Set());
  const [includeArchive, setIncludeArchive] = useState(true);
  const [subject, setSubject] = useState("");
  const [intro, setIntro] = useState("");
  const [sendAgain, setSendAgain] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changeRange(nextStart: string, nextDays: number) {
    setStart(nextStart);
    setDays(nextDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextStart)) return;
    setLoading(true);
    setLoadError(null);
    const r = await loadLineup(nextStart, nextDays).catch(() => ({ ok: false as const, error: "Couldn't load the showtimes." }));
    setLoading(false);
    if (!r.ok) return setLoadError(r.error);
    setLineup(r.lineup);
    setSkipMovies(new Set());
    setSkipHappenings(new Set());
    setSendAgain(false);
  }

  const input = {
    start,
    days,
    skipMovieIds: [...skipMovies],
    skipHappeningIds: [...skipHappenings],
    includeArchive,
    subject,
    intro,
  };

  const email: LineupEmail = useMemo(
    () => ({
      ...lineup,
      films: lineup.films.filter((f) => !skipMovies.has(f.movieId) && (includeArchive || !f.archive)),
      happenings: lineup.happenings.filter((h) => !skipHappenings.has(h.id)),
      intro,
    }),
    [lineup, skipMovies, skipHappenings, includeArchive, intro],
  );
  const preview = useMemo(() => lineupEmailHtml(email, { mode: "preview", firstName: myFirstName }), [email, myFirstName]);
  const empty = email.films.length === 0 && email.happenings.length === 0;
  const effectiveSubject = subject.trim() || defaultLineupSubject(lineup.rangeStart, lineup.rangeDays);
  const sentThisRange = sends.find((s) => s.status === "sent" && s.range_start === start);
  const inFlight = sends.find((s) => s.status === "sending");

  function toggle(set: Set<string>, id: string, update: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg({ ok: true, text: "Syncing…" });
    let added = 0;
    let removed = 0;
    let optedOut = 0;
    for (let pass = 0; pass < 20; pass++) {
      const r = await syncMailingListNow().catch(() => null);
      if (!r) {
        setSyncMsg({ ok: false, text: "Couldn't reach the server. Try again." });
        break;
      }
      added += r.added;
      removed += r.removed;
      optedOut += r.optedOut;
      const counts = `${added} added, ${removed} removed${optedOut ? `, ${optedOut} unsubscribed through Resend` : ""}`;
      if (r.complete) {
        setSyncMsg({ ok: true, text: `Up to date: ${r.subscribers} on the list (${counts}).` });
        break;
      }
      if (r.errors.length) {
        setSyncMsg({ ok: false, text: `Stopped: ${r.errors[0]}${r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ""}` });
        break;
      }
      setSyncMsg({ ok: true, text: `Still syncing… ${counts} so far.` });
    }
    setSyncing(false);
    router.refresh();
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    const r = await sendLineupTest(input).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    setTesting(false);
    setTestMsg(r.ok ? { ok: true, text: `Test sent to ${r.to}.` } : { ok: false, text: r.error });
  }

  async function sendToList() {
    setConfirming(false);
    setSending(true);
    setSendMsg(null);
    const r = await sendLineupNow(input, sendKey, sendAgain).catch(() => ({
      ok: false as const,
      error: "Lost touch with the server. Reload the page and check the history below before trying again.",
    }));
    setSending(false);
    setSendMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    // A fresh send key and the updated history.
    router.refresh();
  }

  const problems = [
    !connected && "Email isn't connected yet: RESEND_API_KEY needs adding in Vercel.",
    connected && sender.problem,
    connected && !webhookReady && "Unsubscribe links work, but they only reach the website at the nightly sync until the Resend webhook is set up (RESEND_WEBHOOK_SECRET).",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {/* ---------- the list ---------- */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-[var(--muted)]">On the list</div>
            <div className="text-2xl font-semibold">{subscribers ?? "—"}</div>
            <div className="text-xs text-[var(--muted)]">members who asked for the weekly email</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Last sync with Resend</div>
            {lastSync ? (
              <>
                <div className="text-sm font-semibold">{when(lastSync.started_at)}</div>
                <div className={`text-xs ${lastSync.complete ? "text-[var(--muted)]" : "text-[var(--danger-text)]"}`}>
                  {lastSync.complete
                    ? `${lastSync.added} added, ${lastSync.removed} removed${lastSync.opted_out ? `, ${lastSync.opted_out} unsubscribed` : ""}`
                    : lastSync.errors || "Didn't finish"}
                </div>
              </>
            ) : (
              <div className="text-sm text-[var(--muted)]">Not yet</div>
            )}
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Sent from</div>
            <div className="break-all text-sm font-semibold">{sender.from ?? "—"}</div>
            <div className="text-xs text-[var(--muted)]">Replies go to info@royalecinemajoplin.com</div>
          </div>
        </div>
        {problems.length > 0 && (
          <ul className="notice notice-warn mt-4 list-disc space-y-1 pl-6 text-sm">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-secondary !px-4 !py-2 text-sm" disabled={!connected || syncing} onClick={syncNow}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {syncMsg && <span className={`text-sm ${syncMsg.ok ? "" : "text-[var(--danger-text)]"}`}>{syncMsg.text}</span>}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Happens by itself every night and before every send. Members join or leave from their account, the register&apos;s check-in screen, the join form, or
          the unsubscribe link in any list email. Manage the list here, not in Resend: anyone added there by hand is taken off at the next sync.
        </p>
      </section>

      {/* ---------- compose ---------- */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 font-semibold">Lineup email</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">Starting</div>
            <input type="date" className="rounded border border-[var(--border)] px-2 py-1.5 text-sm" value={start} min={today} onChange={(e) => changeRange(e.target.value, days)} />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">For</div>
            <select className="rounded border border-[var(--border)] px-2 py-1.5 text-sm" value={days} onChange={(e) => changeRange(start, Number(e.target.value))}>
              {DAY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? "day" : "days"}
                </option>
              ))}
            </select>
          </label>
          <span className="pb-2 text-sm text-[var(--muted)]">{loading ? "Loading…" : rangeLabel(lineup.rangeStart, lineup.rangeDays)}</span>
        </div>
        {loadError && <p className="mt-2 text-sm text-[var(--danger-text)]">{loadError}</p>}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">Films (untick to leave one out)</div>
            {lineup.films.length === 0 && <p className="text-sm text-[var(--muted)]">No showtimes in these dates.</p>}
            <ul className="space-y-1">
              {lineup.films.map((f) => (
                <li key={f.movieId}>
                  <label className={`flex items-start gap-2 text-sm ${f.archive && !includeArchive ? "opacity-50" : ""}`}>
                    <input type="checkbox" className="mt-0.5" checked={!skipMovies.has(f.movieId)} onChange={() => toggle(skipMovies, f.movieId, setSkipMovies)} />
                    <span>
                      {f.title} <span className="text-[var(--muted)]">· {f.showtimes.length} {f.showtimes.length === 1 ? "showing" : "showings"}</span>
                      {f.archive && <span className="ml-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">archive</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {lineup.films.some((f) => f.archive) && (
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={includeArchive} onChange={(e) => setIncludeArchive(e.target.checked)} />
                <span>
                  Include the film archive titles
                  <span className="block text-xs text-[var(--muted)]">Older titles we can tell members about but not advertise. They only ever go in this members&apos; email.</span>
                </span>
              </label>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">Also at the Royale</div>
            {lineup.happenings.length === 0 && <p className="text-sm text-[var(--muted)]">No house events in these dates.</p>}
            <ul className="space-y-1">
              {lineup.happenings.map((h) => (
                <li key={h.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={!skipHappenings.has(h.id)} onChange={() => toggle(skipHappenings, h.id, setSkipHappenings)} />
                    <span>
                      {h.title} <span className="text-[var(--muted)]">· {when(h.startsAt)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--muted)]">Private events are never included.</p>
          </div>
        </div>

        <label className="mt-4 block text-sm">
          <div className="mb-1 text-xs text-[var(--muted)]">Subject</div>
          <input className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm" value={subject} maxLength={150} placeholder={effectiveSubject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="mt-3 block text-sm">
          <div className="mb-1 text-xs text-[var(--muted)]">A note at the top (optional)</div>
          <textarea
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm"
            rows={3}
            maxLength={3000}
            value={intro}
            placeholder="Here's what's playing at the Royale. Tap a time to get tickets. Insiders+ members get in free."
            onChange={(e) => setIntro(e.target.value)}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-secondary !px-4 !py-2 text-sm" disabled={!connected || testing || empty || loading} onClick={sendTest}>
            {testing ? "Sending test…" : "Send a test to me"}
          </button>
          <button
            className="btn-primary !px-4 !py-2 text-sm"
            disabled={!sender.ready || sending || empty || loading || !subscribers || !!inFlight || (!!sentThisRange && !sendAgain)}
            onClick={() => setConfirming(true)}
          >
            {sending ? "Sending…" : `Send to ${subscribers ?? 0} member${subscribers === 1 ? "" : "s"}`}
          </button>
          {sentThisRange && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sendAgain} onChange={(e) => setSendAgain(e.target.checked)} />
              Already sent {sentThisRange.sent_at ? when(sentThisRange.sent_at) : ""}. Send it again anyway
            </label>
          )}
        </div>
        {myEmail && <p className="mt-1 text-xs text-[var(--muted)]">Tests go to {myEmail}.</p>}
        {inFlight && <p className="mt-2 text-sm text-[var(--warn-text)]">A send started {when(inFlight.created_at)} is still going out. Reload in a minute.</p>}
        {testMsg && <p className={`mt-2 text-sm ${testMsg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>{testMsg.text}</p>}
        {sendMsg && <p className={`mt-2 text-sm ${sendMsg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>{sendMsg.text}</p>}
      </section>

      {/* ---------- preview ---------- */}
      <section>
        <div className="mb-1 text-xs text-[var(--muted)]">
          Preview · Subject: <strong className="text-[var(--foreground)]">{effectiveSubject}</strong>
        </div>
        <iframe title="Lineup email preview" srcDoc={preview} sandbox="" className="h-[1200px] w-full rounded-lg border border-[var(--border)] bg-white" />
      </section>

      {/* ---------- history ---------- */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 font-semibold">Sent</h2>
        {sends.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing sent to the list yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {sends.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <strong>{s.subject}</strong>
                  <span className="block text-xs text-[var(--muted)]">
                    {when(s.created_at)}
                    {s.sender?.name ? ` · ${s.sender.name}` : ""}
                  </span>
                </span>
                <span className={`text-xs ${s.status === "failed" ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>
                  {s.status === "sent" ? `Sent to ${s.recipients ?? "?"}` : s.status === "sending" ? "Sending…" : `Not sent${s.error ? `: ${s.error}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirming && (
        <ConfirmModal
          title={`Send to ${subscribers ?? 0} members?`}
          description={`"${effectiveSubject}" goes out now. It can't be taken back.`}
          confirmLabel="Send it"
          onConfirm={sendToList}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
