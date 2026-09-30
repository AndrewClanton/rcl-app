import "server-only";
import { createHash } from "node:crypto";
import { bucketOf } from "./rules";

// The one way an address is turned into the value the never-mail list
// (email_suppressions) and the consent log keep: sha256 of the trimmed,
// lower-cased address, in hex. The same as member_email_facts() computes
// in SQL, so the two always agree. No address is ever stored.
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

// Held back from a campaign (to measure the honest lift): decided by
// sha256(member id + campaign id), so it's the same answer every time and
// about pct in 100 people.
export function holdoutBucket(memberId: string, campaignId: string): number {
  return bucketOf(createHash("sha256").update(`${memberId}${campaignId}`, "utf8").digest("hex"));
}

export function isHeldOut(memberId: string, campaignId: string, pct: number): boolean {
  return pct > 0 && holdoutBucket(memberId, campaignId) < pct;
}

// A stable random-looking order (the "random" part of warm-up ordering),
// so a wave picked twice picks the same people.
export function shuffleKey(memberId: string, campaignId: string): string {
  return createHash("sha256").update(`order:${campaignId}:${memberId}`, "utf8").digest("hex");
}
