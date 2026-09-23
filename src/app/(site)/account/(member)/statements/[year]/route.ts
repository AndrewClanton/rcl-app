import type { NextRequest } from "next/server";
import { getSignedInMember } from "@/lib/member-auth";
import { getYearStatement, yearOf } from "@/lib/data/member-account";
import { getMembershipBilling } from "@/lib/data/member-billing";
import { renderStatementPdf } from "@/lib/pdf/documents";

// A year of purchases, Insiders+ billing, sales tax and points, as a PDF.
export async function GET(req: NextRequest, ctx: RouteContext<"/account/statements/[year]">) {
  const { year: raw } = await ctx.params;
  const year = Number(raw);
  const thisYear = yearOf(new Date().toISOString());
  if (!Number.isInteger(year) || year < 2015 || year > thisYear) return new Response("Not found", { status: 404 });
  const member = await getSignedInMember();
  if (!member) return Response.redirect(new URL("/account/login", req.url));

  const [statement, billing] = await Promise.all([getYearStatement(member.id, year), getMembershipBilling(member)]);
  const pdf = await renderStatementPdf({
    statement,
    member: { name: member.name, email: member.email, tier: member.tier, since: member.created_at },
    invoices: billing?.invoices ?? [],
  });
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="royale-statement-${year}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
