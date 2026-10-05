"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { addNote, setOrganization } from "@/lib/member-notes-server";
import { cleanNote, type MemberNote } from "@/lib/member-notes";
import { allowAttempt } from "@/lib/rate-limit";

// Staff-only notes and the organization label on the member's page
// (NotesBox.tsx, lib/member-notes.ts). Any staff, like the register.

const ID = /^[0-9a-f-]{36}$/i;
const TOO_FAST = "Too many changes at once. Wait a minute, then try again.";

export async function addMemberNoteAdmin(memberId: string, text: string): Promise<{ ok: true; note: MemberNote } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !ID.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!cleanNote(text)) return { ok: false, error: "Type a note first." };
  if (!(await allowAttempt(`member-note:${staff.employeeId}`, 30, 300))) return { ok: false, error: TOO_FAST };
  const note = await addNote(memberId, text, staff.employeeId);
  if (!note) return { ok: false, error: "Couldn't save the note. Try again." };
  revalidatePath(`/admin/members/${memberId}`);
  return { ok: true, note };
}

export async function setMemberOrganizationAdmin(memberId: string, value: string): Promise<{ ok: true; organization: string | null } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !ID.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!(await allowAttempt(`member-org:${staff.employeeId}`, 30, 300))) return { ok: false, error: TOO_FAST };
  const org = await setOrganization(memberId, value);
  if (org === undefined) return { ok: false, error: "Couldn't save that. Try again." };
  revalidatePath(`/admin/members/${memberId}`);
  revalidatePath("/admin/members");
  return { ok: true, organization: org };
}
