"use client";

import { useEffect, useState } from "react";
import { drawerXml, testPageXml } from "@/lib/print/receipt";
import { printerBaseUrl, type PrintResult } from "@/lib/print/epos-client";
import { STATION_LABEL, STATIONS, type RegisterStation } from "@/lib/print/stations";
import { listReaders, type ReaderOption } from "../terminal-actions";
import { getStationPrinterStatus, type StationPrinterStatus } from "../print-actions";
import { printTargetOf, sendPrint } from "../printing";
import { saveDeviceSettings, useDeviceSettings } from "./settings";
import InfoTip from "@/components/help/InfoTip";
import { TABLET_SOUND_DEFAULT } from "@/lib/registerChannel";
import { agoLabel, readerNeedsLook, type ReaderHealth } from "@/lib/terminal/reader-status";
import type { ReaderMonitor } from "./reader-monitor";

const WISEPOS_SETUP_URL = "https://docs.stripe.com/terminal/payments/setup-reader/bbpos-wisepos-e#settings";

// The chosen reader's health (useReaderMonitor): a big online/offline dot,
// when Stripe last heard from it, what it is and what it's doing, how often
// it dropped off today, and what to do when it's offline. Stripe has no
// battery level for this reader, so the panel says so.
export function ReaderStatusCard({ health, checking, onCheck }: { health: ReaderHealth | null; checking: boolean; onCheck: () => void }) {
  // "Last seen 12 s ago" keeps counting while the panel is open.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const down = readerNeedsLook(health);
  const known = !!health && health.found && health.checkedAt !== null;
  const state = !health ? "Checking…" : !health.found ? "Not in Stripe" : !known ? "Unknown" : down ? "Offline" : "Online";
  const color = !known ? "var(--muted)" : down ? "var(--danger-text)" : "var(--success-text, green)";
  const details = health && [health.model, health.serialLast4 && `serial ··${health.serialLast4}`, health.software && `software ${health.software}`, health.ip && `IP ${health.ip}`].filter(Boolean).join(" · ");
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm" style={{ borderColor: down ? "var(--danger-text)" : "var(--border)" }}>
      <div className="flex items-center gap-3">
        <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: color, boxShadow: known && !down ? "0 0 0 4px color-mix(in srgb, var(--success-text, green) 25%, transparent)" : undefined }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold leading-tight" style={{ color }}>
            {state}
          </div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            {health?.lastSeenAt && now ? `Last seen ${agoLabel(now - health.lastSeenAt)}` : health?.found === false ? "Pick another reader below." : "Not seen yet"}
            {health?.stripeError && " · couldn't reach Stripe just now"}
          </div>
        </div>
        <button className="btn-secondary shrink-0 !px-3 !py-1.5 text-sm" disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      {health?.found && (
        <div className="space-y-0.5 text-xs">
          <div>
            <span className="font-bold">{health.label ?? "Card reader"}</span>
            {details ? <span style={{ color: "var(--muted)" }}> · {details}</span> : null}
          </div>
          {health.location && <div style={{ color: "var(--muted)" }}>Location: {health.location}</div>}
          <div>
            Now: <span className="font-bold">{down ? "Not reachable" : (health.doing ?? "Idle")}</span>
            {" · "}
            <span style={{ color: health.offlineToday > 0 ? "var(--danger-text)" : "var(--muted)" }}>
              {health.offlineToday === 0 ? "Not offline today" : `Offline ${health.offlineToday} time${health.offlineToday === 1 ? "" : "s"} today`}
            </span>
          </div>
        </div>
      )}
      <p className="text-xs font-semibold">Battery % isn&apos;t available from Stripe for this reader; keep it on its charger.</p>
      <details open={down} className="text-xs">
        <summary className="cursor-pointer font-semibold">If it&apos;s offline</summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Plug it in, or set it on its charging dock.</li>
          <li>Check its Wi-Fi: swipe in from the left edge → Settings → Wi-Fi.</li>
          <li>Still stuck: hold the power button to restart it.</li>
          <li>
            To see the battery: swipe in from the left edge → Settings (the passcode is on{" "}
            <a className="underline" href={WISEPOS_SETUP_URL} target="_blank" rel="noreferrer">
              Stripe&apos;s reader page
            </a>
            ) → Diagnostics.
          </li>
        </ol>
      </details>
    </div>
  );
}

// The "Devices" button on the register: which register this is (Bar or
// Outdoor stand), its card reader, how it prints (through the website to
// the station's printer, or straight to a printer's IP the old way),
// whether receipts print on their own, test buttons for the printer and
// the cash drawer, and the customer screen's sound effects (on or off, and
// how loud), sent to the screen over the register's channel.
export default function DevicesPanel({
  onReprint,
  onReprintTickets,
  fallbackReaderId,
  sendToTablet,
  reader,
  buttonClassName = "chip relative shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm",
}: {
  // This register's reader, watched by the register (useReaderMonitor).
  reader: ReaderMonitor;
  onReprint: (() => Promise<PrintResult>) | null;
  onReprintTickets: (() => Promise<PrintResult>) | null;
  fallbackReaderId: string | null;
  // To the customer screen over the register's channel ("sound", "sound-test").
  sendToTablet: (event: string, payload: object) => void;
  buttonClassName?: string;
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
  const readerDown = readerNeedsLook(reader.health);
  const stationLabel = STATION_LABEL[settings.station];
  // What the customer screen plays: as set here, else its own default.
  const sound = { on: settings.tabletSound ?? TABLET_SOUND_DEFAULT.on, volume: settings.tabletVolume ?? TABLET_SOUND_DEFAULT.volume };
  const readerSide = settings.readerSide ?? "right";

  return (
    <>
      <button
        className={buttonClassName}
        title={readerDown ? "Card reader offline" : missing.length ? `No ${missing.join(" or ")} set up on this register` : undefined}
        aria-label={readerDown ? "Devices: card reader offline" : missing.length ? `Devices: no ${missing.join(" or ")} set up` : "Devices"}
        onClick={() => {
          setAddress(settings.printerAddress);
          setResult(null);
          setOpen(true);
          void loadReaders();
          reader.check();
          if (settings.printVia === "station") void loadStationPrinter(settings.station);
        }}
      >
        Devices
        {/* Red: something on this register still needs setting up, or its
            card reader is offline. */}
        {(missing.length > 0 || readerDown) &&<span className="absolute -right-1 -top-1 h-3 w-3 rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 0 2px var(--surface)" }} aria-hidden />}
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
                <InfoTip topic="card-reader-status" />
              </div>
              {readerId && <ReaderStatusCard health={reader.health} checking={reader.checking} onCheck={() => reader.check(true)} />}
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
              <div className="pt-1 text-sm">
                <div className="flex items-center">
                  Card reader is to the left or right of the customer screen
                  <InfoTip topic="pay-on-reader" />
                </div>
                <div className="mt-1.5 flex gap-2" role="radiogroup" aria-label="Card reader is to the left or right of the customer screen">
                  {(["left", "right"] as const).map((side) => (
                    <button
                      key={side}
                      role="radio"
                      aria-checked={readerSide === side}
                      className={`chip flex-1 !px-3 !py-2 text-sm ${readerSide === side ? "chip-selected font-bold" : ""}`}
                      onClick={() => saveDeviceSettings({ readerSide: side })}
                    >
                      {side === "left" ? "← Left" : "Right →"}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  As the guest faces it. The customer screen&apos;s &quot;Finish on the card reader&quot; arrow points this way.
                </p>
              </div>
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

            <section className="space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <div className="label-xs flex items-center">
                Customer screen sounds
                <InfoTip topic="devices-tablet-sound" />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  id="tablet-sound-on"
                  type="checkbox"
                  className="h-5 w-5"
                  checked={sound.on}
                  onChange={(e) => {
                    const next = { ...sound, on: e.target.checked };
                    saveDeviceSettings({ tabletSound: next.on, tabletVolume: next.volume });
                    sendToTablet("sound", next);
                    if (next.on) sendToTablet("sound-test", {});
                  }}
                />
                Play sound effects on the customer screen
              </label>
              <label className="block text-sm" htmlFor="tablet-sound-volume">
                <span className="flex items-baseline justify-between">
                  <span>Volume</span>
                  <span className="tabular-nums" style={{ color: "var(--muted)" }}>
                    {sound.volume}%
                  </span>
                </span>
                <input
                  id="tablet-sound-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  className="mt-1 h-11 w-full"
                  style={{ accentColor: "var(--accent)" }}
                  disabled={!sound.on}
                  value={sound.volume}
                  onChange={(e) => {
                    const next = { ...sound, volume: Number(e.target.value) };
                    saveDeviceSettings({ tabletSound: next.on, tabletVolume: next.volume });
                    sendToTablet("sound", next);
                  }}
                  // Let go of the slider: a sample at the new level.
                  onPointerUp={() => sendToTablet("sound-test", {})}
                  onKeyUp={() => sendToTablet("sound-test", {})}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-secondary" disabled={!sound.on} onClick={() => sendToTablet("sound-test", {})}>
                  Play a test sound
                </button>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  Silent? Tap the customer screen once, and check the iPad&apos;s own volume.
                </span>
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Short arcade blips for check-ins, items, the total, paying and the fun stuff. Keep it low: the cinema is right next door.
              </p>
            </section>

            <p className="text-xs" style={{ color: "var(--muted)" }}>
              These choices are saved on this device only, so each register can have its own reader and printer. The sound settings are also kept on the customer screen.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
