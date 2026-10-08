// Pulling the staff calendar straight from Google Drive, for Back office >
// Showtimes > Sync from calendar and scripts/sync-calendar.mjs.
//
// Where it lives: the link a manager saved on the sync page (settings key
// "calendar_sheet_url"), else the server-only env var CALENDAR_SHEET_URL.
// Either a Google Sheets link (docs.google.com/spreadsheets/d/<id>/...) or a
// Drive file link (drive.google.com/file/d/<id>/..., ...?id=<id>). The sheet
// must be shared "Anyone with the link can view": there is no Google sign-in.
//
// Both kinds come down as .xlsx bytes, the same thing the upload hands
// readCalendarFile. The link and the contents are never logged or sent to
// the browser.
//
// No server-only imports: plain node scripts load this file too.

export const CALENDAR_SHEET_SETTING = "calendar_sheet_url";

export const DRIVE_DENIED =
  "Google wouldn't share the calendar. Open the sheet → Share → General access: Anyone with the link → Viewer.";

const MOST_BYTES = 8 * 1024 * 1024;

// The file id in a Sheets or Drive link (or a bare id), and whether it's a
// Google Sheet. null when it isn't a link we know.
export function parseSheetLink(raw: string): { id: string; sheets: boolean } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[\w-]{25,}$/.test(s)) return { id: s, sheets: false };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const inPath = u.pathname.match(/\/d\/([\w-]{10,})/);
  if (host === "docs.google.com" && u.pathname.startsWith("/spreadsheets/") && inPath) return { id: inPath[1], sheets: true };
  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") {
    if (inPath) return { id: inPath[1], sheets: false };
    const q = u.searchParams.get("id");
    if (q && /^[\w-]{10,}$/.test(q)) return { id: q, sheets: false };
  }
  return null;
}

// Where to download it from, in order. A link opened in Sheets may be a
// real Google Sheet (export) or an .xlsx kept in Drive (download), so a
// Sheets link tries both.
export function exportUrls(link: { id: string; sheets: boolean }): string[] {
  const id = encodeURIComponent(link.id);
  const drive = `https://drive.google.com/uc?export=download&id=${id}`;
  return link.sheets ? [`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, drive] : [drive];
}

export type DriveFetch = { ok: true; bytes: Buffer } | { ok: false; error: string };

// .xlsx is a zip: it starts "PK".
const isXlsx = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

export async function fetchCalendarFromDrive(rawLink: string): Promise<DriveFetch> {
  const link = parseSheetLink(rawLink);
  if (!link) return { ok: false, error: "The saved Google Drive link doesn't look like a Google Sheets or Drive file link. Save the sheet's link again." };
  let denied = false;
  let missing = false;
  for (const url of exportUrls(link)) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    } catch {
      return { ok: false, error: "Couldn't reach Google Drive. Try again in a minute, or upload the file instead." };
    }
    if (res.status === 401 || res.status === 403 || /accounts\.google\.com/.test(res.url)) {
      denied = true;
      continue;
    }
    if (res.status === 404 || res.status === 400) {
      missing = true;
      continue;
    }
    if (!res.ok) return { ok: false, error: "Google Drive had a problem sending the calendar. Try again in a minute, or upload the file instead." };
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MOST_BYTES) return { ok: false, error: "That Google Drive file is too big to be the calendar. Check the saved link." };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MOST_BYTES) return { ok: false, error: "That Google Drive file is too big to be the calendar. Check the saved link." };
    if (isXlsx(bytes)) return { ok: true, bytes };
    // An HTML page instead of the file: Google's sign-in (or "request
    // access") page, so the sheet isn't shared by link.
    if (/text\/html/i.test(res.headers.get("content-type") ?? "") || bytes.subarray(0, 64).toString("utf8").trimStart().startsWith("<")) {
      denied = true;
      continue;
    }
    return { ok: false, error: "What Google Drive sent isn't a spreadsheet. Check the saved link points at the calendar." };
  }
  if (denied) return { ok: false, error: DRIVE_DENIED };
  // Google answers "not found" for a file you can't see, too.
  if (missing) return { ok: false, error: `${DRIVE_DENIED} If it already is, check the saved link is the calendar's.` };
  return { ok: false, error: DRIVE_DENIED };
}
