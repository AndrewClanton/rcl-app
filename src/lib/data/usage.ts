import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, daysBetween } from "@/lib/report-periods";
import type { Area } from "@/lib/usage";

// Reports -> Website usage: page views and time on screen, added up by the
// database (page_view_report in migration 20260930041500_page_views.sql)
// for a stretch of business dates, for one audience at a time.

export type UsageAudience = "customers" | "staff" | "screens";

export const AUDIENCES: Record<UsageAudience, { label: string; areas: Area[] }> = {
  customers: { label: "Customers", areas: ["site", "account"] },
  staff: { label: "Staff", areas: ["admin", "pos", "training"] },
  screens: { label: "Screens", areas: ["display"] },
};

export function isAudience(s: string | undefined): s is UsageAudience {
  return s === "customers" || s === "staff" || s === "screens";
}

export interface UsageTotals {
  views: number; // pages that were found (the 404 is counted apart)
  visitors: number; // different browsers
  sessions: number; // visits
  seconds: number; // on screen
  newVisitors: number;
  notFound: number;
}

export interface UsagePage {
  key: string; // pattern, plus the movie for a showtime page
  pattern: string;
  area: Area;
  movieId: string | null;
  movieTitle: string | null;
  views: number;
  visitors: number;
  seconds: number;
  trend: number[]; // views per bucket, oldest first
}

export interface UsageReport {
  audience: UsageAudience;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  bucketDays: number; // days per trend point
  buckets: number;
  totals: UsageTotals;
  previous: UsageTotals | null;
  staffBrowserViews: number; // customer views left out: browsers also used for staff pages
  pages: UsagePage[];
  days: { date: string; views: number; visitors: number; seconds: number }[];
  entries: { key: string; pattern: string; movieTitle: string | null; views: number }[];
  referrers: { host: string; visits: number }[];
  devices: { device: string; visits: number }[];
  hours: { hour: number; views: number }[];
  roles: { pattern: string; role: string; views: number; seconds: number }[];
  missing: { path: string; views: number }[];
  firstDate: string | null; // the first day anything was counted
  error: string | null;
}

const EMPTY: UsageTotals = { views: 0, visitors: 0, sessions: 0, seconds: 0, newVisitors: 0, notFound: 0 };

interface Raw {
  totals: UsageTotals | null;
  previous: UsageTotals | null;
  staffBrowserViews: number | null;
  pages: { pattern: string; area: Area; movie_id: string | null; movie_title: string | null; views: number; visitors: number; seconds: number }[];
  trend: { pattern: string; movie_id: string | null; bucket: number; views: number }[];
  days: { date: string; views: number; visitors: number; seconds: number }[];
  entries: { pattern: string; movie_id: string | null; movie_title: string | null; views: number }[];
  referrers: { host: string; visits: number }[];
  devices: { device: string; visits: number }[];
  hours: { hour: number; views: number }[];
  roles: { pattern: string; role: string; views: number; seconds: number }[];
  missing: { path: string; views: number }[];
}

const pageKey = (pattern: string, movieId: string | null) => (movieId ? `${pattern}#${movieId}` : pattern);

export async function getUsageReport(audience: UsageAudience, start: string, end: string): Promise<UsageReport> {
  const length = daysBetween(start, end) + 1;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(start, -length);
  // About a month of points at most, so a long stretch stays readable.
  const bucketDays = Math.max(1, Math.ceil(length / 31));
  const buckets = Math.ceil(length / bucketDays);

  const base: UsageReport = {
    audience,
    start,
    end,
    previousStart,
    previousEnd,
    bucketDays,
    buckets,
    totals: EMPTY,
    previous: null,
    staffBrowserViews: 0,
    pages: [],
    days: [],
    entries: [],
    referrers: [],
    devices: [],
    hours: [],
    roles: [],
    missing: [],
    firstDate: null,
    error: null,
  };

  const supabase = createAdminClient();
  const [{ data, error }, first] = await Promise.all([
    supabase.rpc("page_view_report", {
      p_start: start,
      p_end: end,
      p_areas: AUDIENCES[audience].areas,
      p_bucket_days: bucketDays,
      p_prev_start: previousStart,
      p_prev_end: previousEnd,
      // Customers are counted without browsers that also open staff pages
      // (someone checking the site from the office or the register).
      p_skip_staff_browsers: audience === "customers",
    }),
    supabase.from("page_views").select("business_date").order("business_date", { ascending: true }).limit(1).maybeSingle(),
  ]);
  base.firstDate = (first.data as { business_date: string } | null)?.business_date ?? null;
  if (error || !data) return { ...base, error: error?.message ?? "No answer from the database." };
  const r = data as Raw;

  const trends = new Map<string, number[]>();
  for (const t of r.trend ?? []) {
    const key = pageKey(t.pattern, t.movie_id);
    const row = trends.get(key) ?? new Array<number>(buckets).fill(0);
    if (t.bucket >= 0 && t.bucket < buckets) row[t.bucket] += Number(t.views);
    trends.set(key, row);
  }

  return {
    ...base,
    totals: r.totals ?? EMPTY,
    // No comparison with days before counting started: they'd read as zero.
    previous: base.firstDate && base.firstDate <= previousStart ? r.previous : null,
    staffBrowserViews: Number(r.staffBrowserViews ?? 0),
    pages: (r.pages ?? []).map((p) => {
      const key = pageKey(p.pattern, p.movie_id);
      return {
        key,
        pattern: p.pattern,
        area: p.area,
        movieId: p.movie_id,
        movieTitle: p.movie_title,
        views: Number(p.views),
        visitors: Number(p.visitors),
        seconds: Number(p.seconds),
        trend: trends.get(key) ?? new Array<number>(buckets).fill(0),
      };
    }),
    days: r.days ?? [],
    entries: (r.entries ?? []).map((e) => ({ key: pageKey(e.pattern, e.movie_id), pattern: e.pattern, movieTitle: e.movie_title, views: Number(e.views) })),
    referrers: r.referrers ?? [],
    devices: r.devices ?? [],
    hours: r.hours ?? [],
    roles: r.roles ?? [],
    missing: r.missing ?? [],
  };
}
