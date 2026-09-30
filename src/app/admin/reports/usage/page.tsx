import { requireManager } from "@/lib/auth";
import { getUsageReport, isAudience } from "@/lib/data/usage";
import { businessDay } from "@/lib/ops/time";
import { addDays, isDate } from "@/lib/report-periods";
import UsageScreen, { type UsageRange } from "./UsageScreen";

export const dynamic = "force-dynamic";

// Reports -> Website usage: which pages get used, and for how long, so we
// know what customers look at and which staff screens matter most.
// Managers and up. Counted by src/lib/usage-client.ts; added up in
// src/lib/data/usage.ts.
//
// The address says what to show (so a link can be sent):
//   /admin/reports/usage                         customers, the last 7 days
//   ?who=staff | ?who=screens                    the back office and register, or the TVs
//   ?range=today | 7 | 30                        today, or the last 7 or 30 days
//   ?range=custom&from=2026-10-01&to=2026-10-15  any dates in the last 13 months

type Params = { who?: string; range?: string; from?: string; to?: string };

// Page views are kept for 13 months (record_page_view clears older ones).
const KEPT_DAYS = 395;

function periodFrom(p: Params, today: string): { range: UsageRange; start: string; end: string } {
  const earliest = addDays(today, -KEPT_DAYS);
  if (p.range === "today") return { range: "today", start: today, end: today };
  if (p.range === "30") return { range: "30", start: addDays(today, -29), end: today };
  if (p.range === "custom") {
    let from = isDate(p.from) ? p.from : addDays(today, -6);
    let to = isDate(p.to) ? p.to : today;
    if (to < from) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (from < earliest) from = earliest;
    return { range: "custom", start: from, end: to < from ? from : to };
  }
  return { range: "7", start: addDays(today, -6), end: today };
}

export default async function WebsiteUsagePage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const today = businessDay().date;
  const who = isAudience(p.who) ? p.who : "customers";
  const { range, start, end } = periodFrom(p, today);
  const [, report] = await Promise.all([requireManager(), getUsageReport(who, start, end)]);
  return <UsageScreen report={report} range={range} today={today} earliest={addDays(today, -KEPT_DAYS)} />;
}
