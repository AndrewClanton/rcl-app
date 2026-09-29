"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PrinterOverview, PrintJobRow } from "@/lib/data/printers";
import { STATION_LABEL, type RegisterStation } from "@/lib/print/stations";
import { createPrinter, removePrinter, reprintJob, resetPrinterPassword, testPrinter, updatePrinter, type Credentials, type PrinterFields } from "./actions";

const TZ = "America/Chicago";
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  queued: { label: "Waiting", color: "var(--muted)" },
  sent: { label: "Printing", color: "var(--muted)" },
  printed: { label: "Printed", color: "var(--success-text, green)" },
  failed: { label: "Failed", color: "var(--danger-text)" },
  expired: { label: "Expired", color: "var(--danger-text)" },
  cancelled: { label: "Cancelled", color: "var(--muted)" },
};

const KIND_LABEL: Record<string, string> = { sdp: "Epson, Server Direct Print", relay: "Old TM-m30 via the Pi relay" };

function jobsFor(p: Pick<PrinterOverview, "receiptStation" | "orderTickets">): string {
  const parts = [p.receiptStation ? `${STATION_LABEL[p.receiptStation]} receipts, tickets & drawer` : null, p.orderTickets ? "Kitchen order tickets" : null].filter(Boolean);
  return parts.length ? parts.join(" + ") : "Nothing yet";
}

type Setup = { name: string; kind: string; interval: number; creds: Extract<Credentials, { ok: true }> };

export default function PrintersAdmin({ printers, jobs, pollUrl }: { printers: PrinterOverview[]; jobs: PrintJobRow[]; pollUrl: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Keep "Online" and the job list current while the page is open.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => clearInterval(t);
  }, [router]);

  async function act(key: string, job: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) {
    setBusy(key);
    setMessage(null);
    const r = await job().catch(() => ({ ok: false as const, error: "Couldn't reach the website. Try again." }));
    setBusy(null);
    setMessage(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  const byRole = (station: RegisterStation | "kitchen") => printers.find((p) => p.active && (station === "kitchen" ? p.orderTickets : p.receiptStation === station)) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold">Printers</h1>
        <p className="text-sm text-[var(--muted)]">
          The receipt printers and the kitchen printer collect their print jobs from the website every few seconds, so the registers never talk to a printer directly. A
          register chooses this under Devices → &quot;Print through the website&quot;.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {(["bar", "outdoor", "kitchen"] as const).map((role) => {
          const p = byRole(role);
          return (
            <div key={role} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="label-xs">{role === "kitchen" ? "Kitchen order tickets" : `${STATION_LABEL[role]} receipts`}</div>
              {p ? (
                <div className="mt-1 text-sm">
                  <span className="font-semibold">{p.name}</span>
                  <div style={{ color: p.online ? "var(--success-text, green)" : "var(--danger-text)" }}>{p.seen}</div>
                </div>
              ) : (
                <div className="mt-1 text-sm text-[var(--muted)]">Not set up{role === "kitchen" ? ": orders don't print a kitchen ticket" : ""}</div>
              )}
            </div>
          );
        })}
      </section>

      {message && <div className={`notice ${message.ok ? "notice-success" : "notice-warn"} text-sm`}>{message.text}</div>}

      {setup && <SetupPanel setup={setup} pollUrl={pollUrl} onDone={() => setSetup(null)} />}

      <section className="space-y-3">
        {printers.length === 0 && !adding && <p className="text-sm text-[var(--muted)]">No printers yet.</p>}
        {printers.map((p) =>
          editing === p.id ? (
            <PrinterForm
              key={p.id}
              title={`Edit ${p.name}`}
              initial={{ name: p.name, location: p.location ?? "", receiptStation: p.receiptStation, orderTickets: p.orderTickets, pollInterval: p.pollInterval, active: p.active, kind: p.kind }}
              showActive
              onCancel={() => setEditing(null)}
              onSave={async (f) => {
                const r = await updatePrinter(p.id, f);
                if (r.ok) {
                  setEditing(null);
                  setMessage({ ok: true, text: `${f.name} saved.` });
                  router.refresh();
                }
                return r;
              }}
            />
          ) : (
            <div key={p.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" style={p.active ? undefined : { opacity: 0.6 }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {p.name}
                    {!p.active && <span className="ml-2 text-xs font-bold uppercase text-[var(--muted)]">Off</span>}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {[p.location, KIND_LABEL[p.kind], `ID ${p.loginId}`, p.reportedName && `calls itself "${p.reportedName}"`].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-1 text-sm">Prints: {jobsFor(p)}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold" style={{ color: p.online ? "var(--success-text, green)" : "var(--danger-text)" }}>
                    {p.seen}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {p.queued} waiting · <span style={p.failed ? { color: "var(--danger-text)" } : undefined}>{p.failed} failed</span> ·{" "}
                    <span style={p.expired ? { color: "var(--danger-text)" } : undefined}>{p.expired} expired</span>
                    <span className="block">failed/expired in the last day</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-secondary !px-3 !py-1.5 text-sm" disabled={!!busy || !p.active} onClick={() => act(`test-${p.id}`, () => testPrinter(p.id), `Test page sent to ${p.name}. It prints the next time the printer checks in.`)}>
                  {busy === `test-${p.id}` ? "Sending…" : "Test print"}
                </button>
                <button className="btn-secondary !px-3 !py-1.5 text-sm" disabled={!!busy} onClick={() => setEditing(p.id)}>
                  Edit
                </button>
                <button
                  className="btn-secondary !px-3 !py-1.5 text-sm"
                  disabled={!!busy}
                  onClick={async () => {
                    if (!window.confirm(`Make a new password for ${p.name}? The old one stops working right away, so the printer is offline until the new one is typed into it.`)) return;
                    setBusy(`pw-${p.id}`);
                    const r = await resetPrinterPassword(p.id).catch(() => null);
                    setBusy(null);
                    if (!r || !r.ok) return setMessage({ ok: false, text: r?.error ?? "Couldn't reach the website. Try again." });
                    setSetup({ name: p.name, kind: p.kind, interval: p.pollInterval, creds: r });
                    router.refresh();
                  }}
                >
                  New password
                </button>
                <button
                  className="btn-secondary !px-3 !py-1.5 text-sm"
                  style={{ color: "var(--danger-text)" }}
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${p.name} and its print history? It stops getting print jobs right away.`)) void act(`rm-${p.id}`, () => removePrinter(p.id), `${p.name} removed.`);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ),
        )}

        {adding ? (
          <PrinterForm
            title="Add a printer"
            initial={{ name: "", location: "", receiptStation: null, orderTickets: false, pollInterval: 5, active: true, kind: "sdp" }}
            showKind
            onCancel={() => setAdding(false)}
            onSave={async (f) => {
              const r = await createPrinter(f);
              if (r.ok) {
                setAdding(false);
                setSetup({ name: f.name, kind: f.kind, interval: f.pollInterval, creds: r });
                router.refresh();
              }
              return r;
            }}
          />
        ) : (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            Add printer
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Recent print jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing printed through the website yet.</p>
        ) : (
          // Capped at the screen, so on a phone the table scrolls sideways
          // instead of widening the whole page.
          <div className="max-w-[calc(100vw-2rem)] overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Printer</th>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const s = STATUS_STYLE[j.status] ?? { label: j.status, color: "var(--muted)" };
                  const canReprint = (j.status === "failed" || j.status === "expired") && j.kind !== "drawer";
                  return (
                    <tr key={j.id} className="border-b border-[var(--border)] align-top last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{stamp(j.createdAt)}</td>
                      <td className="px-3 py-2">{j.printerName}</td>
                      <td className="px-3 py-2">{j.label ?? j.kind}</td>
                      <td className="px-3 py-2">
                        <span className="font-semibold" style={{ color: s.color }}>
                          {s.label}
                        </span>
                        {j.attempts > 1 && <span className="text-xs text-[var(--muted)]"> · {j.attempts} tries</span>}
                        {j.error && j.status !== "printed" && <div className="text-xs text-[var(--muted)]">{j.error}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canReprint && (
                          <button className="chip !px-3 !py-1 text-xs" disabled={!!busy} onClick={() => act(`re-${j.id}`, () => reprintJob(j.id), `Sent again to ${j.printerName}.`)}>
                            {busy === `re-${j.id}` ? "Sending…" : "Reprint"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">
          Receipts and tickets expire if they aren&apos;t picked up within 10 minutes, a drawer kick within 2, a kitchen ticket within an hour, so a printer coming back
          online never prints something long after the customer left. Jobs are kept for two weeks.
        </p>
      </section>
    </div>
  );
}

type FormValues = PrinterFields & { active: boolean; kind: string };

function PrinterForm({
  title,
  initial,
  showKind,
  showActive,
  onSave,
  onCancel,
}: {
  title: string;
  initial: FormValues;
  showKind?: boolean;
  showActive?: boolean;
  onSave: (f: FormValues) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormValues>) => setF((cur) => ({ ...cur, ...patch }));

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--muted)]">
          Name
          <input className="input mt-1 block w-full" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Kitchen printer" />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Where it is
          <input className="input mt-1 block w-full" value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Kitchen, by the pass" />
        </label>
      </div>

      {showKind && (
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs text-[var(--muted)]">What kind</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="printer-kind" checked={f.kind === "sdp"} onChange={() => set({ kind: "sdp" })} />
            A new Epson (TM-m30II-H or TM-m30III) that collects its own jobs (Server Direct Print)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="printer-kind" checked={f.kind === "relay"} onChange={() => set({ kind: "relay", receiptStation: f.receiptStation ?? "bar" })} />
            The old TM-m30 at the bar, through the Raspberry Pi relay
          </label>
        </fieldset>
      )}

      <fieldset className="mt-3">
        <legend className="mb-1 text-xs text-[var(--muted)]">What it prints</legend>
        <div className="flex flex-wrap gap-2">
          {([null, "bar", "outdoor"] as const).map((s) => (
            <button key={s ?? "none"} type="button" className={`chip !px-3 !py-1.5 !text-sm ${f.receiptStation === s ? "chip-selected font-bold" : ""}`} onClick={() => set({ receiptStation: s })}>
              {s ? `${STATION_LABEL[s]} receipts` : "No receipts"}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.orderTickets} onChange={(e) => set({ orderTickets: e.target.checked })} />
          Kitchen order tickets (every order from both registers)
        </label>
        <p className="mt-1 text-xs text-[var(--muted)]">One printer per job: choosing one here takes it off any other printer.</p>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-xs text-[var(--muted)]">
          Checks in every (seconds)
          <input className="input mt-1 block w-24" type="number" min={2} max={60} value={f.pollInterval} onChange={(e) => set({ pollInterval: Number(e.target.value) })} />
        </label>
        {showActive && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
            On (gets print jobs)
          </label>
        )}
      </div>

      {error && <div className="notice notice-warn mt-3 text-sm">{error}</div>}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const r = await onSave(f).catch(() => ({ ok: false as const, error: "Couldn't reach the website. Try again." }));
            setSaving(false);
            if (!r.ok) setError(r.error);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="chip !px-2 !py-0.5 text-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Setting({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="py-1.5 pr-3 align-top text-[var(--muted)]">{label}</td>
      <td className="py-1.5 pr-3 font-mono text-sm break-all" style={secret ? { color: "var(--accent)" } : undefined}>
        {value}
      </td>
      <td className="py-1.5 text-right align-top">
        <Copy text={value} />
      </td>
    </tr>
  );
}

// What to type into the printer (or the Pi), shown once, right after the
// printer is added or gets a new password.
function SetupPanel({ setup, pollUrl, onDone }: { setup: Setup; pollUrl: string; onDone: () => void }) {
  const { creds } = setup;
  const relayConf = [`RCL_POLL_URL=${pollUrl}`, `RCL_PRINTER_ID=${creds.loginId}`, `RCL_PRINTER_PASSWORD=${creds.password}`, "RCL_PRINTER_IP=10.0.0.175", `RCL_INTERVAL=${setup.interval}`].join("\n");
  return (
    <section className="max-w-[calc(100vw-2rem)] rounded-lg border-2 p-4" style={{ borderColor: "var(--accent)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Set up {setup.name}</h2>
        <button className="btn-secondary !px-3 !py-1 text-sm" onClick={onDone}>
          Done, hide the password
        </button>
      </div>
      <p className="notice notice-warn mt-2 text-sm">
        The password is shown only now. Type it into the printer before you close this. If it&apos;s lost, press &quot;New password&quot; on the printer to make another.
      </p>

      {setup.kind === "relay" ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            On the Raspberry Pi next to the bar printer, follow <span className="font-mono">scripts/pi-print-relay/README.md</span>. When it asks for the settings, put these
            lines in <span className="font-mono">/etc/rcl-print-relay.conf</span> (change the printer IP if the TM-m30 ever gets a new one):
          </p>
          <pre className="max-w-[calc(100vw-4rem)] overflow-x-auto rounded border border-[var(--border)] p-3 font-mono text-xs">{relayConf}</pre>
          <Copy text={relayConf} />
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <table className="w-full">
            <tbody>
              <Setting label="Server Direct Print" value="Enable" />
              <Setting label="Server 1: URL" value={pollUrl} />
              <Setting label="Server 1: Interval(s)" value={String(setup.interval)} />
              <Setting label="ID" value={creds.loginId} />
              <Setting label="Password" value={creds.password} secret />
              <Setting label="Name" value={setup.name.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "Printer"} />
              <Setting label="URL Encode" value="Enable" />
              <Setting label="Server Authentication" value="Enable" />
            </tbody>
          </table>
          <p className="text-xs text-[var(--muted)]">Leave Server 2 and Server 3 off.</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Plug the printer into the theater&apos;s network with an Ethernet cable and turn it on. When it gets an address it prints it. (Or print a status sheet: open the paper cover, hold Feed for a second, close the cover, and follow the &quot;Next Action&quot; sheet.)</li>
            <li>
              On a computer or phone on the theater&apos;s network, open <span className="font-mono">http://</span>
              <em>the printer&apos;s IP</em>. Any certificate warning is only about the printer&apos;s own settings page, on that device; continue.
            </li>
            <li>Log in (Advanced Settings). The password is the printer&apos;s serial number, on the label underneath, unless someone changed it.</li>
            <li>Open TM-Intelligent. Check that ePOS-Print is Enabled.</li>
            <li>Open Server Direct Print and type in the settings above. Press Access Test next to Server 1, then Set. The printer may restart.</li>
            <li>Come back here: within a minute it should say Online. Press Test print.</li>
          </ol>
          <div className="rounded border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
            <div className="mb-1 font-semibold text-[var(--foreground)]">If Access Test fails</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>Certificate or SSL error: Network Security → Root Certificate Update → Update, and check Date and Time under Device Management.</li>
              <li>
                Authentication error: check the ID and password. If they&apos;re right and it still fails, change the URL to <span className="font-mono">{pollUrl}?auth=basic</span>.
              </li>
              <li>Can&apos;t connect: the printer needs to reach the internet. Check the network cable, and that the router gives it an address.</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
