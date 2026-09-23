import type { NextRequest } from "next/server";
import { getSignedInMember } from "@/lib/member-auth";
import { getReceipt } from "@/lib/data/member-account";
import { renderReceiptPdf } from "@/lib/pdf/documents";

// The receipt as a downloadable PDF. Only the member it belongs to can get
// it: getReceipt scopes by the signed-in member's id.
export async function GET(req: NextRequest, ctx: RouteContext<"/account/purchases/[kind]/[id]/pdf">) {
  const { kind, id } = await ctx.params;
  if (kind !== "order" && kind !== "ticket") return new Response("Not found", { status: 404 });
  const member = await getSignedInMember();
  if (!member) return Response.redirect(new URL("/account/login", req.url));
  const receipt = await getReceipt(member, kind, id);
  if (!receipt) return new Response("Not found", { status: 404 });
  const pdf = await renderReceiptPdf(receipt);
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="royale-receipt-${receipt.number.replace(/[^\w-]/g, "")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
