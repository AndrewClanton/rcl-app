import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Who's asking /api/print/poll for print jobs. Each printer (or the Pi relay)
// has its own ID and password, typed into its Server Direct Print settings
// once (Back office -> Printers). Only hashes are stored.
//
// Epson printers answer an HTTP Digest challenge (the SDP manual's "Digest
// Access Authentication": a first request with no password gets 401, the
// next carries it), so that's the default challenge. HTTP Basic is accepted
// too, sent up front (the Pi relay does this, over HTTPS); a printer that
// only speaks Basic can be pointed at the URL with ?auth=basic to be
// challenged that way instead.

// Part of every stored Digest hash: changing it locks every printer out.
export const PRINTER_REALM = "Royale Cinema Lounge printers";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

// The printer's settings page allows letters, digits, "_", "." and "-", 30
// at most. Passwords skip look-alikes (0/O, 1/l/I) in case one's typed by
// hand: 24 of 57 characters is about 140 bits.
const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const pick = (chars: string, n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");

export function newLoginId(): string {
  return `rcl-${pick(ID_CHARS, 8)}`;
}

export function newPrinterPassword(): string {
  return pick(PASSWORD_CHARS, 24);
}

export function hashPrinterPassword(loginId: string, password: string): { secret_sha256: string; digest_ha1: string } {
  return { secret_sha256: sha256(password), digest_ha1: md5(`${loginId}:${PRINTER_REALM}:${password}`) };
}

// ---------- nonces ----------
// Stateless: the time it was made plus a keyed hash of it, good for ten
// minutes, so no nonce table is needed. The printer is told "stale" when
// one has run out, and simply asks again.
const NONCE_TTL_MS = 10 * 60 * 1000;

function nonceKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createHmac("sha256", secret).update("print-digest-nonce-v1").digest();
}

function nonceSig(ts: string): string {
  return createHmac("sha256", nonceKey()).update(ts).digest("base64url").slice(0, 22);
}

export function newNonce(now = Date.now()): string {
  const ts = now.toString(36);
  return `${ts}.${nonceSig(ts)}`;
}

function nonceState(nonce: string, now = Date.now()): "ok" | "stale" | "bad" {
  const [ts, sig] = nonce.split(".");
  if (!ts || !sig || !/^[0-9a-z]{1,12}$/.test(ts) || !safeEqual(sig, nonceSig(ts))) return "bad";
  const age = now - parseInt(ts, 36);
  if (age < -60_000) return "bad";
  return age > NONCE_TTL_MS ? "stale" : "ok";
}

// ---------- challenges ----------
export function authChallenge(scheme: "digest" | "basic", stale = false): string {
  if (scheme === "basic") return `Basic realm="${PRINTER_REALM}", charset="UTF-8"`;
  return `Digest realm="${PRINTER_REALM}", qop="auth", algorithm=MD5, nonce="${newNonce()}", opaque="rcl-print"${stale ? ", stale=true" : ""}`;
}

// ---------- the Authorization header ----------
export type PrinterCredentials =
  | { scheme: "basic"; user: string; password: string }
  | { scheme: "digest"; user: string; params: Record<string, string> };

// key=value or key="value", comma-separated (RFC 7616).
function digestParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/g)) {
    out[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : (m[3] ?? "");
  }
  return out;
}

export function readCredentials(header: string | null): PrinterCredentials | null {
  if (!header || header.length > 2000) return null;
  const space = header.indexOf(" ");
  if (space < 0) return null;
  const scheme = header.slice(0, space).toLowerCase();
  const rest = header.slice(space + 1).trim();
  if (scheme === "basic") {
    let decoded: string;
    try {
      decoded = Buffer.from(rest, "base64").toString("utf8");
    } catch {
      return null;
    }
    const colon = decoded.indexOf(":");
    if (colon < 1) return null;
    return { scheme: "basic", user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  }
  if (scheme === "digest") {
    const params = digestParams(rest);
    if (!params.username) return null;
    return { scheme: "digest", user: params.username, params };
  }
  return null;
}

// "ok", "stale" (right password, old nonce: challenge again with
// stale=true) or "bad".
export function checkCredentials(
  creds: PrinterCredentials,
  stored: { secret_sha256: string; digest_ha1: string },
  request: { method: string; path: string },
): "ok" | "stale" | "bad" {
  if (creds.scheme === "basic") return safeEqual(sha256(creds.password), stored.secret_sha256) ? "ok" : "bad";

  const p = creds.params;
  if (!p.nonce || !p.response || !p.uri) return "bad";
  if ((p.realm ?? "") !== PRINTER_REALM) return "bad";
  // The uri it signed must be this endpoint.
  let signedPath: string;
  try {
    signedPath = new URL(p.uri, "https://printer.invalid").pathname;
  } catch {
    return "bad";
  }
  if (signedPath !== request.path) return "bad";
  const algorithm = (p.algorithm ?? "MD5").toUpperCase();
  if (algorithm !== "MD5" && algorithm !== "MD5-SESS") return "bad";
  const ha1 = algorithm === "MD5-SESS" ? md5(`${stored.digest_ha1}:${p.nonce}:${p.cnonce ?? ""}`) : stored.digest_ha1;
  const ha2 = md5(`${request.method}:${p.uri}`);
  const qop = p.qop?.toLowerCase();
  if (qop && qop !== "auth") return "bad";
  const expected = qop ? md5(`${ha1}:${p.nonce}:${p.nc ?? ""}:${p.cnonce ?? ""}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  if (!safeEqual(expected, p.response.toLowerCase())) return "bad";
  const n = nonceState(p.nonce);
  return n === "ok" ? "ok" : n === "stale" ? "stale" : "bad";
}
