"use client";

import { useState } from "react";
import { disconnectGoogleDrive, googlePickerSession, saveGooglePick, type GoogleDriveState } from "./google-actions";

// Connect Google Drive: sign in with Google once (drive.file only), pick
// the calendar in the Google Picker, and the website checks it every hour
// on its own. The file stays an .xlsx, shared exactly as it is.

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const BACK_MESSAGES: Record<string, string> = {
  connected: "Google Drive is connected. Now pick the calendar file.",
  declined: "Google Drive wasn't connected (the Google screen was cancelled).",
  expired: "That took too long or came from another window. Tap Connect Google Drive again.",
  scope: "Google didn't allow access to Drive files. Tap Connect Google Drive again and allow it.",
  failed: "Google Drive couldn't be connected. Try again.",
  setup: "Google Drive isn't set up on the server yet (see below).",
  manager: "Connecting Google Drive takes a manager.",
};

// The few Picker calls used, loosely typed (Google's script, not a package).
interface PickerView {
  setMimeTypes(m: string): PickerView;
  setQuery(q: string): PickerView;
  setOwnedByMe(b: boolean): PickerView;
}
interface PickerApi {
  DocsView: new (viewId?: unknown) => PickerView;
  ViewId: { DOCS: unknown };
  PickerBuilder: new () => PickerBuilder;
  Action: { PICKED: string; CANCEL: string };
}
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setCallback(cb: (d: { action: string; docs?: { id: string; name: string }[] }) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
type GoogleWindow = Window & { gapi?: { load(name: string, cb: () => void): void }; google?: { picker?: PickerApi } };

let pickerReady: Promise<PickerApi> | null = null;
function loadPicker(): Promise<PickerApi> {
  pickerReady ??= new Promise<PickerApi>((resolve, reject) => {
    const w = window as GoogleWindow;
    const done = () => w.gapi!.load("picker", () => (w.google?.picker ? resolve(w.google.picker) : reject(new Error("no picker"))));
    if (w.gapi) return done();
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error("load failed"));
    document.head.appendChild(s);
  }).catch((e) => {
    pickerReady = null;
    throw e;
  });
  return pickerReady;
}

export default function GoogleDriveConnect({ state, back }: { state: GoogleDriveState; back: string | null }) {
  const [fileName, setFileName] = useState(state.fileName);
  const [connected, setConnected] = useState(state.connected);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(back ? (BACK_MESSAGES[back] ?? "") : "");

  async function pick() {
    setBusy(true);
    setMsg("");
    try {
      const s = await googlePickerSession();
      if (!s.ok) return setMsg(s.error);
      let picker: PickerApi;
      try {
        picker = await loadPicker();
      } catch {
        return setMsg("Google's file picker didn't load. Check the connection and try again.");
      }
      const search = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(XLSX).setQuery("RCL Calendar");
      const shared = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(XLSX).setOwnedByMe(false);
      const all = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(XLSX);
      new picker.PickerBuilder()
        .addView(search)
        .addView(shared)
        .addView(all)
        .setOAuthToken(s.token)
        .setDeveloperKey(s.apiKey)
        .setAppId(s.appId)
        .setTitle("Pick the staff calendar (RCL Calendar 2026.xlsx)")
        .setCallback(async (d) => {
          if (d.action !== picker.Action.PICKED || !d.docs?.[0]) return;
          setBusy(true);
          const r = await saveGooglePick(d.docs[0].id);
          setBusy(false);
          if (r.ok) {
            setFileName(r.fileName);
            setMsg(`Done. "${r.fileName}" is checked every hour from now on, and Pull latest from Google Drive above reads it too.`);
          } else setMsg(r.error);
        })
        .build()
        .setVisible(true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Google Drive? The hourly calendar check from the website stops until someone connects it again.")) return;
    setBusy(true);
    const r = await disconnectGoogleDrive();
    setBusy(false);
    if (r.ok) {
      setConnected(false);
      setFileName(null);
      setMsg("Google Drive is disconnected.");
    } else setMsg(r.error);
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Hourly check from Google Drive</h2>
      {state.missing.length ? (
        <>
          <p className="text-sm">
            Connect Google Drive isn&rsquo;t set up on the server yet, so the website can&rsquo;t check the calendar on its own. Nothing else is affected: Pull and upload above still work.
          </p>
          <p className="text-sm text-[var(--muted)]">
            Missing in Vercel (Settings → Environment Variables): {state.missing.map((m, i) => <span key={m}>{i ? ", " : ""}<code>{m}</code></span>)}. An owner sets these up once in Google Cloud Console and Vercel.
          </p>
          <button type="button" className="btn-secondary min-h-11 text-base" disabled>
            Connect Google Drive
          </button>
        </>
      ) : !connected ? (
        <>
          <p className="text-sm text-[var(--muted)]">
            Sign in with the Google account that can open the calendar, then pick the file. The website gets read access to that one file only, nothing else in Drive, and the file&rsquo;s sharing doesn&rsquo;t change. After that the schedule is checked every hour.
          </p>
          <a href="/api/google-drive/connect" className="btn-primary inline-flex min-h-11 items-center text-base">
            Connect Google Drive
          </a>
        </>
      ) : (
        <>
          <p className="text-sm">
            {fileName ? (
              <>
                Connected. The website checks <strong>{fileName}</strong> every hour.
              </>
            ) : (
              "Connected. Now pick the calendar file so the website can read it."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${fileName ? "btn-secondary" : "btn-primary"} min-h-11 text-base`} disabled={busy} onClick={() => void pick()}>
              {busy ? "Opening Google…" : fileName ? "Pick a different file" : "Pick the calendar file"}
            </button>
            <button type="button" className="min-h-11 px-2 text-sm underline" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      )}
      {msg && <p className="text-sm">{msg}</p>}
    </section>
  );
}
