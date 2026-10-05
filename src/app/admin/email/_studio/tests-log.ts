import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// "Tested on my phone": when each person last sent themselves a test of
// each email, for the step tracks on the Email pages. There's no column
// for it, so it's one email_settings row (key 'email_tests'):
//   { emails: { "design:come-in": { <employeeId>: { at, name } }, "campaign:<id>": {...} } }
// Only the step tracks read it; nothing about sending does. Written after
// a test has gone, and a failure here never fails the test. Two tests in
// the same instant can lose one tick, nothing more.

const KEY = "email_tests";
const KEEP_DAYS = 120;

export interface TestMark {
  at: string;
  name: string; // first name, for "Mary, Oct 2"
}
export type TestLog = Record<string, Record<string, TestMark>>;

export const designTestKey = (key: string) => `design:${key}`;
export const campaignTestKey = (id: string) => `campaign:${id}`;

export async function testLog(): Promise<TestLog> {
  try {
    const { data, error } = await createAdminClient().from("email_settings").select("value").eq("key", KEY).maybeSingle();
    if (error || !data) return {};
    const emails = (data.value as { emails?: unknown } | null)?.emails;
    return emails && typeof emails === "object" ? (emails as TestLog) : {};
  } catch {
    return {};
  }
}

export async function recordTest(email: string, staff: { employeeId: string; name: string }): Promise<void> {
  try {
    const log = await testLog();
    const now = new Date();
    const oldest = now.getTime() - KEEP_DAYS * 86_400_000;
    const next: TestLog = {};
    for (const [k, people] of Object.entries(log)) {
      const kept = Object.fromEntries(Object.entries(people ?? {}).filter(([, m]) => Date.parse(m?.at ?? "") >= oldest));
      if (Object.keys(kept).length) next[k] = kept;
    }
    next[email] = { ...(next[email] ?? {}), [staff.employeeId]: { at: now.toISOString(), name: staff.name.trim().split(/\s+/)[0] || "Someone" } };
    await createAdminClient()
      .from("email_settings")
      .upsert({ key: KEY, value: { emails: next }, updated_by: staff.employeeId, updated_at: now.toISOString() }, { onConflict: "key" });
  } catch {
    // Only the step track misses it.
  }
}

export interface LastTest {
  at: string;
  who: string; // "You", or their first name
  mine: boolean;
}

// The viewer's own last test of this email, or else anyone's latest.
export function lastTestOf(log: TestLog, email: string, me: string): LastTest | null {
  const people = log[email];
  if (!people) return null;
  const own = people[me];
  if (own?.at) return { at: own.at, who: "You", mine: true };
  const latest = Object.values(people)
    .filter((m) => m?.at)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return latest ? { at: latest.at, who: latest.name, mine: false } : null;
}

// "today 2:14 PM", "Oct 2, 2:14 PM" (Central).
export function testWhen(iso: string, now = new Date()): string {
  const tz = "America/Chicago";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  if (day(d) === day(now)) return `today ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}, ${time}`;
}
