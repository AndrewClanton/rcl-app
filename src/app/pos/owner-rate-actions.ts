"use server";

import { assertStaff } from "@/lib/auth";
import { currentMemberId } from "@/lib/member-forward";
import { ownerForMember, priceOwnerSale, type OwnerPricedLine, type OwnerSaleLine } from "@/lib/owner-rate-server";
import { ownerSaleProblems } from "@/lib/register-totals";

// The register's "Owner rate" tick (lib/register-totals.ts says what it is):
// the order priced by the server from today's menu, for the order on
// screen. Only when the member on the order is an owner's own account with
// the owner rate on. Asked again whenever the order changes; completeOrder
// (./actions.ts) prices it again when it's paid.

export type OwnerRateQuote =
  | { ok: true; firstName: string; lines: OwnerPricedLine[]; totals: { subtotal: number; tax: number; total: number }; menuValue: number }
  | { ok: false; error: string };

export async function quoteOwnerRate(memberId: string | null, lines: OwnerSaleLine[]): Promise<OwnerRateQuote> {
  await assertStaff();
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: "Ring something up first." };
  const owner = await ownerForMember(await currentMemberId(memberId));
  if (owner === undefined) return { ok: false, error: "The owner rate couldn't be checked. Try again." };
  if (!owner) return { ok: false, error: "The owner rate is only for an owner's own account on the order." };
  const priced = await priceOwnerSale(lines);
  if (!priced.ok) return { ok: false, error: `This can't be rung at the owner rate: ${priced.problems[0]}` };
  const problems = ownerSaleProblems({ lines }, priced);
  if (problems.length) return { ok: false, error: problems[0] };
  return { ok: true, firstName: owner.firstName, lines: priced.lines, totals: priced.totals, menuValue: priced.menuValue };
}
