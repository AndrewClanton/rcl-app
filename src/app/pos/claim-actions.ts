"use server";

import { assertStaff } from "@/lib/auth";
import { issueClaimLink } from "@/lib/member-claim";
import { allowAttempt } from "@/lib/rate-limit";

// A "claim your account" link for the receipt of a member on a sale who has
// no website login (lib/member-claim.ts): good for two weeks, once. Staff
// only, and capped per login, since each call makes a working link. Null
// whenever there's nothing to print (they have a login, the member_claims
// migration isn't applied yet, over the cap): the receipt just prints
// without it.
export async function getReceiptClaimUrl(memberId: string): Promise<string | null> {
  const staff = await assertStaff();
  if (typeof memberId !== "string") return null;
  if (!(await allowAttempt(`claim-receipt:${staff.employeeId}`, 60, 600))) return null;
  return issueClaimLink(memberId, "receipt");
}
