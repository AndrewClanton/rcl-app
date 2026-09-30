"use server";

import { assertStaff } from "@/lib/auth";
import { openShiftOwner, weekHoursSoFar } from "@/lib/data/team";

// The register's "My hours: 12 h 30 m this week", for whoever's shift this
// iPad started. Only for a shift that's open right now (someone at the
// register can already see who's on); counts the shift they're on so far.
export async function getShiftWeekHours(shiftId: string): Promise<{ ok: true; hours: number } | { ok: false }> {
  await assertStaff();
  if (typeof shiftId !== "string") return { ok: false };
  const owner = await openShiftOwner(shiftId);
  if (!owner) return { ok: false };
  return { ok: true, hours: await weekHoursSoFar(owner.employeeId) };
}
