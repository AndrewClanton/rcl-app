import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaMissing } from "@/lib/schema-missing";

// "Connect Google Drive" for the staff calendar (Back office > Showtimes >
// Sync from calendar): a manager signs in with Google once, with only the
// drive.file scope, and picks "RCL Calendar 2026.xlsx" in the Google
// Picker. That gives this app read access to that one file and nothing
// else in their Drive, with no change to how the file is shared. The
// hourly cron (/api/cron/calendar-sync) then downloads it with the Drive
// API and syncs.
//
// drive.file is a non-sensitive scope, so Google needs no app review.
//
// Env (Vercel, server-only except where noted):
//   GOOGLE_OAUTH_CLIENT_ID      the OAuth client (Web application). Its
//                               project number (the digits before the "-")
//                               is the Picker's app id.
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_PICKER_API_KEY       an API key restricted to the Picker API and
//                               our website; handed to the manager's
//                               browser for the Picker only.
//   CALENDAR_TOKEN_KEY          any long random string: the refresh token is
//                               kept AES-256-GCM encrypted with it.
//
// Kept in settings "calendar_google_drive" (server-only: RLS on, no
// policies). The refresh token is never sent to a browser or logged.

export const GOOGLE_DRIVE_SETTING = "calendar_google_drive";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CALLBACK_PATH = "/api/google-drive/callback";
export const STATE_COOKIE = "rcl_gdrive_state";
const MOST_BYTES = 8 * 1024 * 1024;

const ENV_NAMES = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_PICKER_API_KEY", "CALENDAR_TOKEN_KEY"] as const;

export function missingGoogleEnv(): string[] {
  return ENV_NAMES.filter((n) => !(process.env[n] ?? "").trim());
}

const env = (n: (typeof ENV_NAMES)[number]) => (process.env[n] ?? "").trim();

// The Cloud project number, which the Picker needs as its app id so a
// picked file is shared with this app.
export function pickerAppId(): string {
  return env("GOOGLE_OAUTH_CLIENT_ID").split("-")[0] ?? "";
}

// ---------- the refresh token, encrypted ----------
function key() {
  return createHash("sha256").update(env("CALENDAR_TOKEN_KEY")).digest();
}
const b64 = (b: Buffer) => b.toString("base64url");

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
}

export function openToken(sealed: string): string | null {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null; // the key changed: connect again
  }
}

// ---------- the saved connection ----------
export interface DriveConnection {
  token: string; // sealed refresh token
  fileId: string | null;
  fileName: string | null;
  connectedAt: string;
  connectedBy: string | null; // employee id
}

export async function loadConnection(): Promise<DriveConnection | null> {
  const { data, error } = await createAdminClient().from("settings").select("value").eq("key", GOOGLE_DRIVE_SETTING).maybeSingle();
  if (error) {
    if (schemaMissing(error)) return null;
    throw error;
  }
  const v = data?.value as Partial<DriveConnection> | null | undefined;
  if (!v || typeof v.token !== "string") return null;
  return {
    token: v.token,
    fileId: typeof v.fileId === "string" ? v.fileId : null,
    fileName: typeof v.fileName === "string" ? v.fileName : null,
    connectedAt: typeof v.connectedAt === "string" ? v.connectedAt : new Date(0).toISOString(),
    connectedBy: typeof v.connectedBy === "string" ? v.connectedBy : null,
  };
}

export async function saveConnection(c: DriveConnection, by: string | null): Promise<void> {
  const { error } = await createAdminClient()
    .from("settings")
    .upsert({ key: GOOGLE_DRIVE_SETTING, value: c, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
  if (error) throw error;
}

export async function deleteConnection(): Promise<void> {
  const { error } = await createAdminClient().from("settings").delete().eq("key", GOOGLE_DRIVE_SETTING);
  if (error) throw error;
}

// ---------- OAuth ----------
export function authUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_FILE_SCOPE,
    access_type: "offline",
    // Always hands back a refresh token, even to someone who connected before.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenAnswer = { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenCall(body: Record<string, string>): Promise<TokenAnswer> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_OAUTH_CLIENT_ID"), client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"), ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json().catch(() => ({ error: `http_${res.status}` }))) as TokenAnswer;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ ok: true; refreshToken: string } | { ok: false; error: string }> {
  const t = await tokenCall({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) return { ok: false, error: t.error ?? "no_refresh_token" };
  if (t.scope && !t.scope.split(" ").includes(DRIVE_FILE_SCOPE)) return { ok: false, error: "scope_not_granted" };
  return { ok: true, refreshToken: t.refresh_token };
}

export class DriveError extends Error {}

// A fresh access token (good for about an hour) from the saved refresh token.
export async function accessToken(conn: DriveConnection): Promise<string> {
  const refresh = openToken(conn.token);
  if (!refresh) throw new DriveError("The saved Google Drive connection can't be read (CALENDAR_TOKEN_KEY changed?). Connect Google Drive again in Back office → Showtimes → Sync from calendar.");
  let t: TokenAnswer;
  try {
    t = await tokenCall({ refresh_token: refresh, grant_type: "refresh_token" });
  } catch {
    throw new DriveError("Couldn't reach Google to sign in to Drive. It will try again next hour.");
  }
  if (t.access_token) return t.access_token;
  if (t.error === "invalid_grant") throw new DriveError("Google Drive access was removed or expired. Connect Google Drive again in Back office → Showtimes → Sync from calendar.");
  throw new DriveError(`Google wouldn't sign in to Drive (${t.error ?? "unknown"}). It will try again next hour.`);
}

export async function fileInfo(token: string, fileId: string): Promise<{ id: string; name: string; mimeType: string } | null> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; name: string; mimeType: string };
}

// The picked calendar's .xlsx bytes, straight from Drive (files.get alt=media).
export async function downloadCalendar(conn: DriveConnection): Promise<Buffer> {
  if (!conn.fileId) throw new DriveError("Google Drive is connected but no calendar file is picked. Pick it in Back office → Showtimes → Sync from calendar.");
  const token = await accessToken(conn);
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(conn.fileId)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DriveError("Couldn't reach Google Drive. It will try again next hour.");
  }
  if (res.status === 404 || res.status === 403) throw new DriveError("Google Drive won't hand over the calendar file any more (moved, deleted, or access removed). Pick it again in Back office → Showtimes → Sync from calendar.");
  if (!res.ok) throw new DriveError(`Google Drive had a problem sending the calendar (${res.status}). It will try again next hour.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MOST_BYTES) throw new DriveError("The picked Google Drive file is too big to be the calendar. Pick the calendar again.");
  if (!(bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new DriveError("The picked Google Drive file isn't an .xlsx spreadsheet. Pick the calendar again.");
  return bytes;
}

// Best effort: tells Google to drop the access on disconnect.
export async function revoke(conn: DriveConnection): Promise<void> {
  const refresh = openToken(conn.token);
  if (!refresh) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refresh }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}
