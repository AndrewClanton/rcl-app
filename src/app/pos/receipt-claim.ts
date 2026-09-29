import { isClaimUrl } from "@/lib/claim-link";
import type { ReceiptData } from "@/lib/print/receipt";
import { getReceiptClaimUrl } from "./claim-actions";
import type { PosMember } from "./member-actions";

// The receipt's "scan to see your points online" link, for PosApp's
// receipt printing: only for a member on this sale with no website login,
// and never holding up the printer (or the cash drawer) for long -- if the
// server is slow, the receipt prints without it.
const WAIT_MS = 1500;

export async function receiptClaimUrl(member: PosMember | null, receipt: ReceiptData): Promise<string | null> {
  if (!member || member.hasLogin || receipt.reprint || receipt.member !== member.name) return null;
  const url = await Promise.race([
    getReceiptClaimUrl(member.id).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
  ]);
  return isClaimUrl(url) ? url : null;
}
