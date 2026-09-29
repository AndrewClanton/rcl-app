import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLineup, LINEUP_MAX_DAYS } from "@/lib/data/lineup";
import { defaultLineupSubject, lineupEmailHtml, lineupEmailText, rangeLabel, type LineupEmail } from "@/lib/email/lineup-email";
import { createBroadcast, getBroadcast, sendBroadcast } from "@/lib/email/resend";
import { listSegmentId, mailingListConfigured, reconcileMailingList } from "@/lib/mailing-list";

// Sending the weekly lineup to the members' list as a Resend broadcast.
// Resend adds the one-click unsubscribe headers and fills in each person's
// unsubscribe link; the email itself carries our street address. Both are
// what CAN-SPAM asks of a marketing email.

export const LIST_REPLY_TO = "info@royalecinemajoplin.com";

export interface SenderStatus {
  from: string | null;
  ready: boolean;
  problem: string | null;
}

// A broadcast has to come from a domain verified in Resend, so the test
// sender (onboarding@resend.dev) won't do.
export function senderStatus(): SenderStatus {
  const from = process.env.EMAIL_FROM?.trim() || null;
  if (!mailingListConfigured()) return { from, ready: false, problem: "Email isn't connected yet: RESEND_API_KEY needs adding in Vercel." };
  if (!from) return { from, ready: false, problem: "EMAIL_FROM isn't set in Vercel, so there's no sender for the list." };
  if (/@resend\.dev>?\s*$/i.test(from)) return { from, ready: false, problem: "EMAIL_FROM is still Resend's test address. It has to be an address at royalecinemajoplin.com once the domain is verified." };
  return { from, ready: true, problem: null };
}

export interface ComposeInput {
  start: string;
  days: number;
  skipMovieIds: string[];
  skipHappeningIds: string[];
  includeArchive: boolean;
  subject: string;
  intro: string;
}

// Builds the email from the database -- never from HTML the browser sent.
export async function composeLineup(input: ComposeInput): Promise<{ ok: true; email: LineupEmail; subject: string } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start)) return { ok: false, error: "Pick a start date." };
  const days = Math.floor(Number(input.days));
  if (!(days >= 1 && days <= LINEUP_MAX_DAYS)) return { ok: false, error: `Pick 1 to ${LINEUP_MAX_DAYS} days.` };
  const intro = String(input.intro ?? "").slice(0, 3000);
  const subject = String(input.subject ?? "").trim().slice(0, 150) || defaultLineupSubject(input.start, days);

  let data;
  try {
    data = await getLineup(input.start, days);
  } catch {
    return { ok: false, error: "Couldn't load the showtimes. Try again." };
  }
  const skipMovies = new Set(input.skipMovieIds ?? []);
  const skipHappenings = new Set(input.skipHappeningIds ?? []);
  const films = data.films.filter((f) => !skipMovies.has(f.movieId) && (input.includeArchive || !f.archive));
  const happenings = data.happenings.filter((h) => !skipHappenings.has(h.id));
  if (films.length === 0 && happenings.length === 0) return { ok: false, error: `Nothing to send: no showtimes picked for ${rangeLabel(input.start, days)}.` };
  return { ok: true, email: { ...data, films, happenings, intro }, subject };
}

// A send that never finished (the page closed, the server timed out):
// ask Resend whether the broadcast went, and record the answer.
export async function settleStuckSends(): Promise<void> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await supabase.from("mailing_sends").select("id, resend_broadcast_id").eq("status", "sending").lt("created_at", cutoff);
  for (const row of data ?? []) {
    let went = false;
    if (row.resend_broadcast_id) {
      const b = await getBroadcast(row.resend_broadcast_id);
      went = b.ok && ["queued", "sending", "sent", "scheduled"].includes(b.data.status);
    }
    await supabase
      .from("mailing_sends")
      .update(went ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error: "Didn't finish sending." })
      .eq("id", row.id)
      .eq("status", "sending");
  }
}

export type SendToListResult = { ok: true; recipients: number; message: string } | { ok: false; error: string; alreadySent?: boolean };

export async function sendLineupToList(input: ComposeInput, opts: { sendKey: string; sendAgain: boolean; employeeId: string }): Promise<SendToListResult> {
  if (!/^[0-9a-f-]{36}$/i.test(opts.sendKey)) return { ok: false, error: "Reload the page and try again." };
  const sender = senderStatus();
  if (!sender.ready || !sender.from) return { ok: false, error: sender.problem ?? "Email isn't set up." };
  const built = await composeLineup(input);
  if (!built.ok) return built;

  const supabase = createAdminClient();

  // A double click (or a retried request) carries the same key: report
  // what happened to the first one instead of sending again.
  const { data: same } = await supabase.from("mailing_sends").select("status, recipients, error").eq("send_key", opts.sendKey).maybeSingle();
  if (same) {
    if (same.status === "sent") return { ok: true, recipients: same.recipients ?? 0, message: `Already sent to ${same.recipients ?? 0} members.` };
    if (same.status === "sending") return { ok: false, error: "It's already on its way. Give it a minute, then reload." };
    return { ok: false, error: `That send didn't go through${same.error ? ` (${same.error})` : ""}. Reload the page to try again.` };
  }

  if (!opts.sendAgain) {
    const { data: earlier } = await supabase
      .from("mailing_sends")
      .select("sent_at")
      .eq("status", "sent")
      .eq("range_start", input.start)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (earlier?.sent_at) {
      const when = new Date(earlier.sent_at).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return { ok: false, alreadySent: true, error: `The lineup for ${rangeLabel(input.start, Number(input.days))} already went out ${when}. Tick "Send it again anyway" if you mean to.` };
    }
  }

  await settleStuckSends();
  const { data: claim, error: claimErr } = await supabase
    .from("mailing_sends")
    .insert({ send_key: opts.sendKey, range_start: input.start, range_days: Number(input.days), subject: built.subject, created_by: opts.employeeId })
    .select("id")
    .single();
  if (claimErr || !claim) {
    if (claimErr?.code === "23505") return { ok: false, error: "Another send is going out right now. Give it a minute, then reload." };
    return { ok: false, error: "Couldn't start the send. Try again." };
  }
  const fail = async (error: string) => {
    await supabase.from("mailing_sends").update({ status: "failed", error: error.slice(0, 500) }).eq("id", claim.id);
    return { ok: false as const, error };
  };

  // Everyone who opted in (and nobody who opted out) is on the list first.
  const sync = await reconcileMailingList("send", 40_000);
  if (!sync.complete) {
    return fail(
      sync.errors.length
        ? `Couldn't bring the list up to date, so nothing was sent: ${sync.errors[0]}`
        : "The list is still catching up, so nothing was sent. Press \"Sync now\" until it finishes, then send.",
    );
  }
  if (sync.subscribers === 0) return fail("Nobody is on the list yet, so nothing was sent.");

  const seg = await listSegmentId();
  if (!seg.ok) return fail(seg.error);
  const made = await createBroadcast({
    segmentId: seg.id,
    from: sender.from,
    replyTo: LIST_REPLY_TO,
    subject: built.subject,
    html: lineupEmailHtml(built.email, { mode: "broadcast" }),
    text: lineupEmailText(built.email, { mode: "broadcast" }),
    name: `Lineup ${rangeLabel(built.email.rangeStart, built.email.rangeDays)}`,
  });
  if (!made.ok) return fail(`Resend didn't accept the email: ${made.error}`);
  await supabase.from("mailing_sends").update({ resend_broadcast_id: made.data.id }).eq("id", claim.id);

  const sent = await sendBroadcast(made.data.id);
  if (!sent.ok) {
    // The answer may have been lost on the way back: ask before calling it failed.
    const check = await getBroadcast(made.data.id);
    if (!(check.ok && ["queued", "sending", "sent", "scheduled"].includes(check.data.status))) return fail(`Resend didn't send it: ${sent.error}`);
  }
  await supabase.from("mailing_sends").update({ status: "sent", sent_at: new Date().toISOString(), recipients: sync.subscribers }).eq("id", claim.id);
  return { ok: true, recipients: sync.subscribers, message: `Sent to ${sync.subscribers} member${sync.subscribers === 1 ? "" : "s"}. Resend delivers it over the next few minutes.` };
}
