"use client";

import { useState } from "react";
import { drawerXml, testPageXml } from "@/lib/print/receipt";
import { printerBaseUrl, sendToPrinter, type PrintResult } from "@/lib/print/epos-client";
import { savePrinterSettings, usePrinterSettings } from "./settings";

// The "Printer" button on the register: where the printer lives on the
// network, whether receipts print on their own, and test buttons for the
// printer and the cash drawer.
export default function PrinterPanel({ onReprint }: { onReprint: (() => Promise<PrintResult>) | null }) {
  const settings = usePrinterSettings();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(settings.address);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string; certUrl?: string } | null>(null);

  async function run(label: string, job: () => Promise<PrintResult>, okText: string) {
    setBusy(label);
    setResult(null);
    const r = await job();
    setBusy(null);
    setResult(r.ok ? { tone: "ok", text: okText } : { tone: "error", text: r.error, certUrl: r.certUrl });
  }

  const configured = !!settings.address;

  return (
    <>
      <button className="chip !px-3 !py-1.5 text-sm" onClick={() => { setAddress(settings.address); setResult(null); setOpen(true); }}>
        Printer{configured ? "" : " (not set up)"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-md space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-xl">Receipt printer</h3>
              <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <label className="block">
              <div className="label-xs">Printer address on the theater&apos;s network</div>
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
                  disabled={address.trim() === settings.address}
                  onClick={() => {
                    savePrinterSettings({ address: address.trim() });
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
              <button className="btn-secondary" disabled={!configured || !!busy} onClick={() => run("test", () => sendToPrinter(settings.address, testPageXml(new Date().toISOString())), "Test page sent to the printer.")}>
                {busy === "test" ? "Printing…" : "Print a test page"}
              </button>
              <button className="btn-secondary" disabled={!configured || !!busy} onClick={() => run("drawer", () => sendToPrinter(settings.address, drawerXml()), "Drawer opened.")}>
                {busy === "drawer" ? "Opening…" : "Open cash drawer"}
              </button>
              {onReprint && (
                <button className="btn-secondary" disabled={!configured || !!busy} onClick={() => run("reprint", onReprint, "Last receipt sent to the printer.")}>
                  {busy === "reprint" ? "Printing…" : "Reprint last receipt"}
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
                      {printerBaseUrl(settings.address)}
                    </a>
                    , choose <strong>Advanced → Continue</strong> (or <strong>Visit this website</strong>) to trust the printer, then come back and try again.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <label className="flex items-center gap-2 text-sm">
                <input id="printer-autoprint" type="checkbox" checked={settings.autoPrint} onChange={(e) => savePrinterSettings({ autoPrint: e.target.checked })} />
                Print a receipt after every sale
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input id="printer-drawer" type="checkbox" checked={settings.drawerOnCash} onChange={(e) => savePrinterSettings({ drawerOnCash: e.target.checked })} />
                Open the cash drawer when a sale takes cash
              </label>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                These settings are saved on this device only.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
