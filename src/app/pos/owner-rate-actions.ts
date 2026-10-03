"use server";

import { randomUUID } from "node:crypto";
import { assertStaff } from "@/lib/auth";
import { checkPersonPin } from "@/lib/manager-pin";
import { sealApproval } from "@/lib/approval-token";
import { ownerCostBook, ownerRatePeople } from "@/lib/owner-rate-server";
import { OWNER_RATE_APPROVAL_MS, ownerRateScope, type OwnerBook } from "@/lib/register-totals";

// The register's "Owner rate" (lib/register-totals.ts says what it is):
// the cashier picks the owner, and the owner types their own PIN. Only that
// owner's PIN approves it: nobody can give the owner rate to someone else.
// The approval is signed, for that owner and one order, for 10 minutes
// (lib/approval-token.ts), and comes with the menu's costs so the register
// can show the owner prices. Putting the order on the tab
// (completeOwnerTabOrder in ./actions.ts) checks the approval and prices
// the order again on the server.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OwnerRateApproval =
  | { ok: true; ownerId: string; firstName: string; token: string; nonce: string; book: OwnerBook; expiresAt: number }
  | { ok: false; error: string };

export async function approveOwnerRate(ownerId: string, pin: string): Promise<OwnerRateApproval> {
  const staff = await assertStaff();
  if (typeof ownerId !== "string" || !UUID.test(ownerId)) return { ok: false, error: "Pick whose owner rate it is." };
  const people = await ownerRatePeople();
  if (people === null) return { ok: false, error: "The owner rate isn't set up yet: its database update hasn't been applied." };
  if (!people.some((p) => p.id === ownerId)) {
    return { ok: false, error: "That person doesn't get the owner rate. Owners choose who in Back office, Owner tab." };
  }
  const check = await checkPersonPin(ownerId, typeof pin === "string" ? pin : "", "owner-rate", staff.employeeId);
  if (!check.ok) return check;

  const nonce = randomUUID();
  const now = Date.now();
  const token = sealApproval(ownerRateScope(ownerId, nonce), staff.employeeId, ownerId, OWNER_RATE_APPROVAL_MS, now);
  if (!token) return { ok: false, error: "The owner rate can't be approved on this server right now. Ring it up as a normal sale." };
  let book: OwnerBook;
  try {
    book = await ownerCostBook();
  } catch {
    return { ok: false, error: "Couldn't read the menu's costs. Try again." };
  }
  return { ok: true, ownerId, firstName: check.approvedBy, token, nonce, book, expiresAt: now + OWNER_RATE_APPROVAL_MS };
}
