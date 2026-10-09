"use server";

import { revalidatePath } from "next/cache";
import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import { DriveError, XLSX_MIME, accessToken, deleteConnection, fileInfo, loadConnection, missingGoogleEnv, pickerAppId, revoke, saveConnection } from "@/lib/google-drive-calendar";

// Connect Google Drive (Back office > Showtimes > Sync from calendar):
// what the page shows, the Google Picker's short-lived access, saving the
// picked file, and disconnecting. Managers and up. The refresh token never
// leaves the server.

type Fail = { ok: false; error: string };

export interface GoogleDriveState {
  missing: string[]; // env vars not set: the button explains, nothing breaks
  connected: boolean;
  fileName: string | null;
  connectedAt: string | null;
}

async function manager() {
  const staff = await getStaffSession();
  if (!staff || !hasManagerAccess(staff.role)) return null;
  return staff;
}

export async function googleDriveState(): Promise<GoogleDriveState | null> {
  if (!(await manager())) return null;
  const missing = missingGoogleEnv();
  const conn = missing.length ? null : await loadConnection().catch(() => null);
  return { missing, connected: !!conn, fileName: conn?.fileId ? (conn.fileName ?? "the calendar") : null, connectedAt: conn?.connectedAt ?? null };
}

// What the Picker needs in the browser: a fresh access token (about an
// hour, drive.file only), the Picker API key and the project number.
export async function googlePickerSession(): Promise<{ ok: true; token: string; apiKey: string; appId: string } | Fail> {
  if (!(await manager())) return { ok: false, error: "Connecting Google Drive takes a manager." };
  if (missingGoogleEnv().length) return { ok: false, error: "Google Drive isn't set up on the server yet." };
  const conn = await loadConnection().catch(() => null);
  if (!conn) return { ok: false, error: "Connect Google Drive first." };
  try {
    return { ok: true, token: await accessToken(conn), apiKey: (process.env.GOOGLE_PICKER_API_KEY ?? "").trim(), appId: pickerAppId() };
  } catch (e) {
    return { ok: false, error: e instanceof DriveError ? e.message : "Couldn't reach Google. Try again." };
  }
}

export async function saveGooglePick(fileId: string): Promise<{ ok: true; fileName: string } | Fail> {
  const staff = await manager();
  if (!staff) return { ok: false, error: "Connecting Google Drive takes a manager." };
  const id = String(fileId ?? "").trim();
  if (!/^[\w-]{10,200}$/.test(id)) return { ok: false, error: "That isn't a Google Drive file." };
  const conn = await loadConnection().catch(() => null);
  if (!conn) return { ok: false, error: "Connect Google Drive first." };
  let info;
  try {
    info = await fileInfo(await accessToken(conn), id);
  } catch (e) {
    return { ok: false, error: e instanceof DriveError ? e.message : "Couldn't reach Google. Try again." };
  }
  if (!info) return { ok: false, error: "Google didn't give this app access to that file. Pick it again from the Picker." };
  if (info.mimeType !== XLSX_MIME) return { ok: false, error: `"${info.name}" isn't an .xlsx file. Pick the calendar (RCL Calendar 2026.xlsx).` };
  try {
    await saveConnection({ ...conn, fileId: info.id, fileName: info.name }, staff.employeeId);
  } catch {
    return { ok: false, error: "Couldn't save the pick. Try again." };
  }
  revalidatePath("/admin/screenings/sync");
  return { ok: true, fileName: info.name };
}

export async function disconnectGoogleDrive(): Promise<{ ok: true } | Fail> {
  if (!(await manager())) return { ok: false, error: "Disconnecting Google Drive takes a manager." };
  const conn = await loadConnection().catch(() => null);
  if (conn) await revoke(conn);
  try {
    await deleteConnection();
  } catch {
    return { ok: false, error: "Couldn't disconnect. Try again." };
  }
  revalidatePath("/admin/screenings/sync");
  return { ok: true };
}
