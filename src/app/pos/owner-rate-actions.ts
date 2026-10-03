"use server";

import { randomUUID } from "node:crypto";
import { assertStaff } from "@/lib/auth";
import { checkPersonPin } from "@/lib/manager-pin";
import { sealApproval } from "@/lib/approval-token";
import { ownerOrderHash, ownerRatePeople, priceOwnerSale, type OwnerPricedLine, type OwnerSaleLine } from "@/lib/owner-rate-server";
import { OWNER_RATE_APPROVAL_MS, ownerRateScope, ownerSaleProblems } from "@/lib/register-totals";

// The register's "Owner rate" (lib/register-totals.ts says what it is).
// 1. quoteOwnerRate: the order priced by the server from today's menu, for
//    the PIN box, so the owner sees every line and the total first.
// 2. approveOwnerRate: the owner types their own PIN. Only that owner's PIN
//    approves it: nobody can give the owner rate to someone else. The
//    approval is signed for that owner, for one order (a nonce), for that
//    exact order and total (its hash), for 10 minutes
//    (lib/approval-token.ts). Any change to the order on the register drops
//    it, and putting it on the tab (completeOwnerTabOrder in ./actions.ts)
//    checks all of it again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Quote = { lines: OwnerPricedLine[]; totals: { subtotal: number; tax: number; total: number }; menuValue: number };

export type OwnerRateQuote = ({ ok: true } & Quote) | { ok: false; error: string };

export type OwnerRateApproval = ({ ok: true; ownerId: string; firstName: string; token: string; nonce: string; expiresAt: number } & Quote) | { ok: false; error: string };

// The order at the owner rate, or why it can't go on an owner tab (a line
// rung before a price changed is named, to take off and ring again).
async function quote(lines: OwnerSaleLine[]): Promise<OwnerRateQuote> {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: "Ring something up first." };
  const priced = await priceOwnerSale(lines);
  if (!priced.ok) return { ok: false, error: `This can't go on the owner tab: ${priced.problems[0]}` };
  const problems = ownerSaleProblems({ lines }, priced);
  if (problems.length) return { ok: false, error: problems[0] };
  return { ok: true, lines: priced.lines, totals: priced.totals, menuValue: priced.menuValue };
}

export async function quoteOwnerRate(lines: OwnerSaleLine[]): Promise<OwnerRateQuote> {
  await assertStaff();
  return quote(lines);
}

// shownTotal: the total the PIN box showed the owner. If the order has
// come to something else since, nothing is approved.
export async function approveOwnerRate(ownerId: string, pin: string, lines: OwnerSaleLine[], shownTotal: number): Promise<OwnerRateApproval> {
  const staff = await assertStaff();
  if (typeof ownerId !== "string" || !UUID.test(ownerId)) return { ok: false, error: "Pick whose owner rate it is." };
  const people = await ownerRatePeople();
  if (people === null) return { ok: false, error: "The owner rate isn't set up yet: its database update hasn't been applied." };
  if (!people.some((p) => p.id === ownerId)) {
    return { ok: false, error: "That person doesn't get the owner rate. Owners choose who in Back office, Owner tab." };
  }
  const q = await quote(lines);
  if (!q.ok) return q;
  if (!(Math.abs(q.totals.total - Number(shownTotal)) < 0.005)) {
    return { ok: false, error: `The order comes to $${q.totals.total.toFixed(2)} now, not what was shown. Close this and tap Owner rate again.` };
  }
  const check = await checkPersonPin(ownerId, typeof pin === "string" ? pin : "", "owner-rate", staff.employeeId);
  if (!check.ok) return check;

  const nonce = randomUUID();
  const now = Date.now();
  const token = sealApproval(ownerRateScope(ownerId, nonce, ownerOrderHash(q.lines, q.totals.total)), staff.employeeId, ownerId, OWNER_RATE_APPROVAL_MS, now);
  if (!token) return { ok: false, error: "The owner rate can't be approved on this server right now. Ring it up as a normal sale." };
  return { ok: true, ownerId, firstName: check.approvedBy, token, nonce, expiresAt: now + OWNER_RATE_APPROVAL_MS, lines: q.lines, totals: q.totals, menuValue: q.menuValue };
}
