"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { syncMemberPayments } from "@/lib/membership-payments/sync";

// "Re-read from Stripe" on Reports -> Members (owners and admins): every
// Insiders+ charge, gift and refund since launch, read again and brought up
// to date. Stripe is only read. Safe to press twice: a payment already
// there is never counted again.
export async function rereadMemberPayments(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await assertAdmin();
  const r = await syncMemberPayments({ mode: "backfill", force: true });
  revalidatePath("/admin/reports/members");
  if (!r.ok) return { ok: false, error: r.skipped ? `Couldn't read: ${r.skipped}.` : "Couldn't read Stripe just now. Try again in a minute." };
  if (r.skipped) return { ok: true, message: `Not read: ${r.skipped}.` };
  const c = r.counts;
  if (!c) return { ok: true, message: "Read." };
  const added = c.plus.added + c.gifts.added + c.refunds.added;
  const updated = c.plus.updated + c.gifts.updated + c.refunds.updated;
  return {
    ok: true,
    message: `Read ${c.invoices} paid invoice${c.invoices === 1 ? "" : "s"} from Stripe: ${added ? `${added} new payment${added === 1 ? "" : "s"} added` : "nothing new"}${updated ? `, ${updated} brought up to date` : ""}.`,
  };
}
