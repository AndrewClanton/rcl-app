"use client";

import { useState } from "react";
import { drawerXml, testPageXml } from "@/lib/print/receipt";
import { printerBaseUrl, type PrintResult } from "@/lib/print/epos-client";
import { STATION_LABEL, STATIONS, type RegisterStation } from "@/lib/print/stations";
import { listReaders, type ReaderOption } from "../terminal-actions";
import { getStationPrinterStatus, type StationPrinterStatus } from "../print-actions";
import { printTargetOf, sendPrint } from "../printing";
import { saveDeviceSettings, useDeviceSettings } from "./settings";
import InfoTip from "@/components/help/InfoTip";

// The "Devices" button on the register: which register this is (Bar or
// Outdoor stand), its card reader, how it prints (through the website to
// the station's printer, or straight to a printer's IP the old way),
// whether receipts print on their own, and test buttons for the printer and
// the cash drawer.
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
  const [stationPrinter, setStationPrinter] = useState<StationPrinterStatus | "loading" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string; certUrl?: string } | null>(null);

  async function loadReaders() {
    setReaderError(null);
    const r = await listReaders().catch(() => null);
    if (!r || !r.ok) setReaderError(r?.error ?? "Couldn't load the card readers. Check the connection.");
    else setReaders(r.readers);
  }

  async function loadStationPrinter(station: RegisterStation) {
    setStationPrinter("loading");
    const s = await getStationPrinterStatus(station).catch(() => null);
    setStationPrinter(s ?? "error");
  }

  async function run(label: string, job: () => Promise<PrintResult>, okText: string) {
    setBusy(label);
    setResult(null);
    const r = await job().catch((): PrintResult => ({ ok: false, error: "Couldn't reach the printer." }));
    setBusy(null);
    setResult(r.ok ? { tone: "ok", text: r.pending ? `${okText} It's in line; the printer hasn't confirmed it yet.` : okText } : { tone: "error", text: r.error, certUrl: r.certUrl });
  }

  const readerId = settings.readerId || fallbackReaderId || "";
  const target = printTargetOf(settings);
  const viaStation = settings.printVia === "station";
  const missing = [!readerId && "reader", !target && "printer"].filter(Boolean);
  const stationLabel = STATION_LABEL[settings.station];

  return (
    <>
      <button
        className="chip shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm"
        title={missing.length ? `No ${missing.join(" or ")} set up on this register` : undefined}
        onClick={() => {
          setAddress(settings.printerAddress);
          setResult(null);
          setOpen(true);
          void loadReaders();
          if (settings.printVia === "station") void loadStationPrinter(settings.station);
        }}
      >
        Devices{missing.length ? <span style={{ color: "var(--danger-text)" }}> · set up</span> : null}
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
              <div className="label-xs flex items-center">
                Which register is this?
                <InfoTip topic="devices-station" />
              </div>
              <div className="flex gap-2">
                {STATIONS.map((s) => (
                  <button
                    key={s}
                    className={`chip flex-1 !px-3 !py-2 text-sm ${settings.station === s ? "chip-selected font-bold" : ""}`}
                    onClick={() => {
                      saveDeviceSettings({ station: s });
                      setResult(null);
                      if (settings.printVia === "station") void loadStationPrinter(s);
                    }}
                  >
                    {STATION_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Printed on the kitchen&apos;s order tickets, and picks this register&apos;s printer when it prints through the website.
              </p>
            </section>

            <section className="space-y-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <div className="label-xs flex items-center">
                Card reader next to this register
                <InfoTip topic="devices-reader" />
              </div>
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
              <div className="label-xs flex items-center">
                Receipt printer
                <InfoTip topic="devices-print-via" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="print-via"
                  id="print-via-station"
                  className="mt-1"
                  checked={viaStation}
                  onChange={() => {
                    saveDeviceSettings({ printVia: "station" });
                    setResult(null);
                    void loadStationPrinter(settings.station);
                  }}
                />
                <span>
                  <span className="font-bold">Print through the website</span> to the {stationLabel} printer
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="print-via"
                  id="print-via-direct"
                  className="mt-1"
                  checked={!viaStation}
                  onChange={() => {
                    saveDeviceSettings({ printVia: "direct" });
                    setResult(null);
                  }}
                />
                <span>
                  <span className="font-bold">Print straight to a printer IP</span> (the old way)
                </span>
              </label>

              {viaStation ? (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                  {stationPrinter === "loading" ? (
                    <span style={{ color: "var(--muted)" }}>Checking the {stationLabel} printer…</span>
                  ) : stationPrinter === "error" ? (
                    <span style={{ color: "var(--danger-text)" }}>Couldn&apos;t check the printer. Check the connection.</span>
                  ) : !stationPrinter.set ? (
                    <span style={{ color: "var(--danger-text)" }}>
                      No {stationLabel} printer is set up yet. A manager adds it under Back office → Printers. Until then, use &quot;Print straight to a printer IP&quot;.
                    </span>
                  ) : (
                    <span>
                      <span className="font-bold">{stationPrinter.name}</span>
                      {" · "}
                      <span style={{ color: stationPrinter.online ? "var(--success-text, green)" : "var(--danger-text)" }}>{stationPrinter.seen}</span>
                    </span>
                  )}
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    Receipts, tickets and the drawer go to the website, and the printer collects them. Nothing to accept on this iPad.
                  </p>
                </div>
              ) : (
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
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary"
                  disabled={!target || !!busy}
                  onClick={() => target && run("test", () => sendPrint(target, "test", testPageXml(new Date().toISOString()), "Register test page"), "Test page printed.")}
                >
                  {busy === "test" ? "Printing…" : "Print a test page"}
                </button>
                <button className="btn-secondary" disabled={!target || !!busy} onClick={() => target && run("drawer", () => sendPrint(target, "drawer", drawerXml(), "Drawer (Devices)"), "Drawer opened.")}>
                  {busy === "drawer" ? "Opening…" : "Open cash drawer"}
                </button>
                {onReprint && (
                  <button className="btn-secondary" disabled={!target || !!busy} onClick={() => run("reprint", onReprint, "Last receipt printed.")}>
                    {busy === "reprint" ? "Printing…" : "Reprint last receipt"}
                  </button>
                )}
                {onReprintTickets && (
                  <button className="btn-secondary" disabled={!target || !!busy} onClick={() => run("tickets", onReprintTickets, "Last sale's tickets printed.")}>
                    {busy === "tickets" ? "Printing…" : "Reprint last tickets"}
                  </button>
                )}
              </div>

              {result && (
                <div className={`notice ${result.tone === "ok" ? "notice-success" : "notice-warn"} text-sm`}>
                  {result.text}
                  {result.certUrl && target?.via === "direct" && (
                    <p className="mt-2">
                      First time on this device? Open{" "}
                      <a className="font-bold underline" href={result.certUrl} target="_blank" rel="noreferrer">
                        {printerBaseUrl(target.address)}
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
