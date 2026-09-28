"use client";

import { useState } from "react";
import { drawerXml, testPageXml } from "@/lib/print/receipt";
import { printerBaseUrl, sendToPrinter, type PrintResult } from "@/lib/print/epos-client";
import { listReaders, type ReaderOption } from "../terminal-actions";
import { saveDeviceSettings, useDeviceSettings } from "./settings";

// The "Devices" button on the register: which card reader and receipt
// printer are next to this device, whether receipts print on their own, and
// test buttons for the printer and the cash drawer.
export default function DevicesPanel({
  onReprint,
  onReprintTickets,
  fallbackReaderId,
}: {
  onReprint: (() => Promise<PrintResult>) | null;
  onReprintTickets: (() => Promise<PrintResult>) | null;
  fallbackReaderId: string | null;
}) {
  const settings = useDeviceSettings();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(settings.printerAddress);
  const [readers, setReaders] = useState<ReaderOption[] | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string; certUrl?: string } | null>(null);

  async function loadReaders() {
    setReaderError(null);
    const r = await listReaders().catch(() => null);
    if (!r || !r.ok) setReaderError(r?.error ?? "Couldn't load the card readers. Check the connection.");
    else setReaders(r.readers);
  }

  async function run(label: string, job: () => Promise<PrintResult>, okText: string) {
    setBusy(label);
    setResult(null);
    const r = await job();
    setBusy(null);
    setResult(r.ok ? { tone: "ok", text: okText } : { tone: "error", text: r.error, certUrl: r.certUrl });
  }

  const readerId = settings.readerId || fallbackReaderId || "";
  const printerSet = !!settings.printerAddress;
  const missing = [!readerId && "reader", !printerSet && "printer"].filter(Boolean);

  return (
    <>
      <button
        className="chip !px-3 !py-1.5 text-sm"
        onClick={() => {
          setAddress(settings.printerAddress);
          setResult(null);
          setOpen(true);
          void loadReaders();
        }}
      >
        Devices{missing.length ? ` (no ${missing.join(" or ")})` : ""}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="card max-h-full w-full max-w-md space-y-5 overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-xl">This register&apos;s devices</h3>
              <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <section className="space-y-2">
              <div className="label-xs">Card reader next to this register</div>
              {readerError ? (
                <p className="text-sm" style={{ color: "var(--danger-text)" }}>
                  {readerError}
                </p>
              ) : !readers ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Loading readers…
                </p>
              ) : readers.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  No readers are registered in Stripe yet. Register one in the Stripe dashboard (Terminal → Readers), then reopen this.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {readers.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="radio" name="register-reader" id={`reader-${r.id}`} checked={readerId === r.id} onChange={() => saveDeviceSettings({ readerId: r.id })} />
                      <span className="font-bold">{r.label}</span>
                      <span className="text-xs" style={{ color: r.online ? "var(--success-text, green)" : "var(--muted)" }}>
                        {r.online ? "online" : "offline"}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <label className="block">
                <div className="label-xs">Receipt printer address on the theater&apos;s network</div>
                <div className="flex gap-2">
                  <input
                    id="printer-address"
                    className="input flex-1"
                    inputMode="decimal"
                    placeholder="e.g. 192.168.1.50"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                  <button
                    className="btn-primary !px-4"
                    disabled={address.trim() === settings.printerAddress}
                    onClick={() => {
                      saveDeviceSettings({ printerAddress: address.trim() });
                      setResult({ tone: "ok", text: "Saved. Try a test print." });
                    }}
                  >
                    Save
                  </button>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  To find it: open the printer&apos;s paper cover, hold the Feed button for 3 seconds, then close the cover. It prints a status sheet with the IP address.
                </p>
              </label>

              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" disabled={!printerSet || !!busy} onClick={() => run("test", () => sendToPrinter(settings.printerAddress, testPageXml(new Date().toISOString())), "Test page sent to the printer.")}>
                  {busy === "test" ? "Printing…" : "Print a test page"}
                </button>
                <button className="btn-secondary" disabled={!printerSet || !!busy} onClick={() => run("drawer", () => sendToPrinter(settings.printerAddress, drawerXml()), "Drawer opened.")}>
                  {busy === "drawer" ? "Opening…" : "Open cash drawer"}
                </button>
                {onReprint && (
                  <button className="btn-secondary" disabled={!printerSet || !!busy} onClick={() => run("reprint", onReprint, "Last receipt sent to the printer.")}>
                    {busy === "reprint" ? "Printing…" : "Reprint last receipt"}
                  </button>
                )}
                {onReprintTickets && (
                  <button className="btn-secondary" disabled={!printerSet || !!busy} onClick={() => run("tickets", onReprintTickets, "Last sale's tickets sent to the printer.")}>
                    {busy === "tickets" ? "Printing…" : "Reprint last tickets"}
                  </button>
                )}
              </div>

              {result && (
                <div className={`notice ${result.tone === "ok" ? "notice-success" : "notice-warn"} text-sm`}>
                  {result.text}
                  {result.certUrl && (
                    <p className="mt-2">
                      First time on this device? Open{" "}
                      <a className="font-bold underline" href={result.certUrl} target="_blank" rel="noreferrer">
                        {printerBaseUrl(settings.printerAddress)}
                      </a>
                      , choose <strong>Advanced → Continue</strong> (or <strong>Visit this website</strong>) to trust the printer, then come back and try again.
                    </p>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input id="printer-autoprint" type="checkbox" checked={settings.autoPrint} onChange={(e) => saveDeviceSettings({ autoPrint: e.target.checked })} />
                Print a receipt after every sale
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input id="printer-tickets" type="checkbox" checked={settings.printTickets} onChange={(e) => saveDeviceSettings({ printTickets: e.target.checked })} />
                Print a movie ticket for every admission sold
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input id="printer-drawer" type="checkbox" checked={settings.drawerOnCash} onChange={(e) => saveDeviceSettings({ drawerOnCash: e.target.checked })} />
                Open the cash drawer when a sale takes cash
              </label>
            </section>

            <p className="text-xs" style={{ color: "var(--muted)" }}>
              These choices are saved on this device only, so each register can have its own reader and printer.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
