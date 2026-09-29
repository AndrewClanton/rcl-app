import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAttempt } from "@/lib/rate-limit";
import { authChallenge, checkCredentials, readCredentials } from "@/lib/print/printer-auth";
import { isPermanentPrinterError, printerErrorMessage } from "@/lib/print/printer-errors";
import { parseResponseFile, parseSdpForm, printRequestXml } from "@/lib/print/sdp";

// Where the printers collect their print jobs: Epson Server Direct Print
// (TM-m30II-H / TM-m30III, set up under Back office -> Printers) and the
// Raspberry Pi relay for the bar's old TM-m30 (scripts/pi-print-relay).
// Protocol: lib/print/sdp.ts. Public on the internet, and jobs carry
// customers' names, so every request must carry its own printer's ID and
// password (lib/print/printer-auth.ts), and a printer only ever gets its
// own jobs.
export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000;
const XML = { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" };

// A cheap first line against a flood, before any database work: per server
// instance, per address.
const hits = new Map<string, number[]>();
const blockedUntil = new Map<string, number>();
function flooded(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 300;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const empty = (status = 200, headers: Record<string, string> = {}) => new Response("", { status, headers: { ...XML, ...headers } });

function challenge(req: NextRequest, stale = false) {
  const scheme = req.nextUrl.searchParams.get("auth") === "basic" ? "basic" : "digest";
  return empty(401, { "WWW-Authenticate": authChallenge(scheme, stale) });
}

type Printer = { id: string; login_id: string; secret_sha256: string; digest_ha1: string; active: boolean; reported_name: string | null };

// The printer this request proves it is, or the response to send instead.
async function authenticate(req: NextRequest): Promise<{ printer: Printer } | { response: Response }> {
  const ip = clientIp(req);
  if (flooded(ip) || (blockedUntil.get(ip) ?? 0) > Date.now()) return { response: empty(429, { "Retry-After": "60" }) };
  const creds = readCredentials(req.headers.get("authorization"));
  // The printer's first request of each round has no password: that's the
  // cue to send the challenge (Digest, as the SDP manual describes).
  if (!creds) return { response: challenge(req) };

  let printer: Printer | null = null;
  if (/^[A-Za-z0-9_.-]{1,30}$/.test(creds.user)) {
    const { data } = await createAdminClient().from("printers").select("id, login_id, secret_sha256, digest_ha1, active, reported_name").eq("login_id", creds.user).maybeSingle();
    printer = (data as Printer | null) ?? null;
  }
  const verdict = printer?.active ? checkCredentials(creds, printer, { method: req.method, path: req.nextUrl.pathname }) : "bad";
  if (verdict === "ok" && printer) return { printer };
  if (verdict === "stale") return { response: challenge(req, true) };

  // Wrong ID or password. Counted per address; past the limit, refused
  // outright for a while.
  console.warn("print poll: bad credentials", { ip, user: creds.user.slice(0, 30), scheme: creds.scheme });
  if (!(await allowAttempt(`print-auth-fail:${ip}`, 20, 15 * 60))) {
    blockedUntil.set(ip, Date.now() + 5 * 60_000);
    return { response: empty(429, { "Retry-After": "300" }) };
  }
  return { response: challenge(req) };
}

// A GET (a settings page's "Access Test", say) just checks the password.
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  return "response" in auth ? auth.response : empty();
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { printer } = auth;

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return empty(413);
  const body = await req.text();
  if (body.length > MAX_BODY) return empty(413);
  const form = parseSdpForm(body);
  // The form's ID is the same one the password was checked for.
  if (form.ID && form.ID !== printer.login_id) {
    console.warn("print poll: ID doesn't match the login", { login: printer.login_id });
    return empty(403);
  }

  const db = createAdminClient();
  const type = form.ConnectionType ?? "";

  if (type === "GetRequest") {
    const name = form.Name?.slice(0, 60) || null;
    if (name && name !== printer.reported_name) await db.from("printers").update({ reported_name: name }).eq("id", printer.id);
    const { data, error } = await db.rpc("claim_print_jobs", { p_printer: printer.id, p_max_jobs: 5, p_max_bytes: 500_000 });
    if (error) {
      console.error("print poll: claim failed", error.message);
      return empty(503, { "Retry-After": "10" });
    }
    const claim = data as { status: string; jobs?: { id: string; kind: string; xml: string }[] };
    if (claim.status === "rate_limited") return empty(429, { "Retry-After": "10" });
    if (claim.status !== "ok") return empty(403);
    const jobs = claim.jobs ?? [];
    return jobs.length ? new Response(printRequestXml(jobs), { status: 200, headers: XML }) : empty();
  }

  if (type === "SetResponse") {
    const parsed = parseResponseFile(form.ResponseFile ?? "");
    type Result = { id: string; ok: boolean; error: string | null; retry: boolean };
    let results: Result[] = parsed.results
      .filter((r): r is typeof r & { jobId: string } => !!r.jobId)
      .map((r) => ({ id: r.jobId, ok: r.ok, error: r.ok ? null : printerErrorMessage(r.code), retry: !isPermanentPrinterError(r.code) }));

    // No job ids (an older response format) or the whole answer was
    // refused: settle what this printer has out, in the order it got them.
    if (parsed.envelopeError || (!results.length && parsed.results.length)) {
      const { data: out } = await db.from("print_jobs").select("id").eq("printer_id", printer.id).eq("status", "sent").order("seq");
      const ids = ((out ?? []) as { id: string }[]).map((r) => r.id);
      if (parsed.envelopeError) results = ids.map((id) => ({ id, ok: false, error: `The printer refused the print data: ${parsed.envelopeError}`, retry: false }));
      else if (parsed.results.length === ids.length) results = ids.map((id, i) => ({ id, ok: parsed.results[i].ok, error: parsed.results[i].ok ? null : printerErrorMessage(parsed.results[i].code), retry: !isPermanentPrinterError(parsed.results[i].code) }));
      else {
        const allOk = parsed.results.every((r) => r.ok);
        const code = parsed.results.find((r) => !r.ok)?.code ?? "";
        results = ids.map((id) => ({ id, ok: allOk, error: allOk ? null : printerErrorMessage(code), retry: true }));
      }
    }
    if (results.length) {
      const { error } = await db.rpc("finish_print_jobs", { p_printer: printer.id, p_results: results });
      if (error) console.error("print poll: results not saved", error.message);
    }
    return empty();
  }

  // Status Notification (SetStatus) and anything else: acknowledged.
  return empty();
}
