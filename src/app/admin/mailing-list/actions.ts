"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { getLineup, LINEUP_MAX_DAYS } from "@/lib/data/lineup";
import { lineupEmailHtml, lineupEmailText, type LineupData } from "@/lib/email/lineup-email";
import { sendEmail } from "@/lib/email/send";
import { firstNameOf, reconcileMailingList, type ReconcileResult } from "@/lib/mailing-list";
import { composeLineup, LIST_REPLY_TO, sendLineupToList, type ComposeInput, type SendToListResult } from "@/lib/lineup-send";

// Managers and up. Errors come back as values, since production hides a
// thrown Server Action's message.

export async function loadLineup(start: string, days: number): Promise<{ ok: true; lineup: LineupData } | { ok: false; error: string }> {
  await assertManager();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, error: "Pick a start date." };
  const n = Math.floor(Number(days));
  if (!(n >= 1 && n <= LINEUP_MAX_DAYS)) return { ok: false, error: `Pick 1 to ${LINEUP_MAX_DAYS} days.` };
  try {
    return { ok: true, lineup: await getLineup(start, n) };
  } catch {
    return { ok: false, error: "Couldn't load the showtimes. Try again." };
  }
}

// The same email, to the manager's own login address only.
export async function sendLineupTest(input: ComposeInput): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const staff = await assertManager();
  if (!staff.email) return { ok: false, error: "Your login has no email address to send the test to." };
  const built = await composeLineup(input);
  if (!built.ok) return built;
  const render = { mode: "test" as const, firstName: firstNameOf(staff.name) };
  const r = await sendEmail(staff.email, `[Test] ${built.subject}`, lineupEmailHtml(built.email, render), {
    replyTo: LIST_REPLY_TO,
    text: lineupEmailText(built.email, render),
  });
  return r.ok ? { ok: true, to: staff.email } : { ok: false, error: r.error };
}

export async function sendLineupNow(input: ComposeInput, sendKey: string, sendAgain: boolean): Promise<SendToListResult> {
  const staff = await assertManager();
  try {
    const r = await sendLineupToList(input, { sendKey, sendAgain, employeeId: staff.employeeId });
    revalidatePath("/admin/mailing-list");
    return r;
  } catch {
    return { ok: false, error: "Something went wrong partway. Reload the page to see whether it went out before trying again." };
  }
}

// "Sync now": one pass of the full comparison (the page repeats it until
// it reports complete).
export async function syncMailingListNow(): Promise<ReconcileResult> {
  await assertManager();
  const r = await reconcileMailingList("manual", 40_000);
  revalidatePath("/admin/mailing-list");
  return r;
}
