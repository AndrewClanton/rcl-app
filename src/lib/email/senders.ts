import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffSession } from "@/lib/auth";

// Who sends email to members. Andrew, 10/3: Nathan and Mary shape the
// Royale's public voice, and all of it goes through them. So sending to a
// list is a tick on the person (employees.sends_email), not a role: owners
// include people who never send. Owners pick who on the Email page.
//
// Everyone else who can open Email still looks, counts, drafts and sends
// themselves a test. Stopping stays open to managers (Pause, Undo,
// Emergency stop): stopping an email is never locked away.

// Staff who can be picked: a cashier or a TV login never sends.
export const SENDER_ROLES = ["manager", "admin", "owner"] as const;

export interface SenderRow {
  id: string;
  name: string;
  role: string;
  sends: boolean;
}

// Who can be picked, and who is. null: the column isn't there yet
// (20261003050000_email_senders.sql not applied) or the read failed.
export async function senderRows(): Promise<SenderRow[] | null> {
  const { data, error } = await createAdminClient()
    .from("employees")
    .select("id, name, role, sends_email")
    .eq("active", true)
    .in("role", [...SENDER_ROLES])
    .order("name");
  if (error || !data) return null;
  return data.map((e) => ({ id: e.id as string, name: (e.name as string) ?? "", role: e.role as string, sends: e.sends_email === true }));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// "Nathan and Mary", "Nathan, Mary and Caleb".
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface SenderCheck {
  ok: boolean; // this person may send to members
  names: string[]; // first names of everyone who may
  why: string | null; // when not ok: why, in a sentence for the screen
}

export async function senderCheck(staff: Pick<StaffSession, "employeeId">): Promise<SenderCheck> {
  const rows = await senderRows();
  if (!rows) return { ok: false, names: [], why: "Who sends email isn't set up yet: the database update for it hasn't been applied." };
  const senders = rows.filter((r) => r.sends);
  const names = senders.map((r) => firstName(r.name));
  if (senders.some((r) => r.id === staff.employeeId)) return { ok: true, names, why: null };
  return {
    ok: false,
    names,
    why: names.length
      ? `Only ${joinNames(names)} send${names.length === 1 ? "s" : ""} email to members. You can still look at it and send yourself a test.`
      : "Nobody is picked to send email to members yet. An owner picks who on the Email page.",
  };
}

// For a server action: null when this person may send, else why not.
export async function senderRefusal(staff: Pick<StaffSession, "employeeId">): Promise<string | null> {
  const c = await senderCheck(staff).catch(() => null);
  if (!c) return "Couldn't check who can send. Try again.";
  return c.ok ? null : c.why;
}
