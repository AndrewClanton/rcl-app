import "server-only";
import { resolveTxt } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { getSendingSwitch, masterSettingOn, senderStatus } from "./campaign-send";
import { emailTokensReady } from "./tokens";
import { picturesCheck } from "./designs/ready";

// Back office -> Email: the go-live checklist. Everything that has to be
// true before email goes to lists, each with a line saying what it means,
// ticked by itself wherever it can be checked (Resend, our DNS, the picture
// bucket, the two switches), and by hand for the one that can't (someone
// tried the unsubscribe link in a test email).

export const UNSUBSCRIBE_TESTED = "golive_unsubscribe_tested";
const WEBHOOK_FRESH_DAYS = 7;

export interface GoLiveItem {
  key: "sender" | "webhook" | "unsubscribe" | "pictures" | "master" | "switch" | "dmarc";
  label: string;
  ok: boolean | null; // null: couldn't check just now
  about: string; // one plain line: what it is and why it matters
  detail: string | null; // what was found
}

export interface GoLive {
  items: GoLiveItem[];
  switchOn: boolean;
  switchAt: string | null;
  masterOn: boolean;
  unsubscribeTested: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

// The domain our list email comes from (EMAIL_FROM), or the website's.
function sendingDomain(): string {
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const m = /@([^\s>]+)>?\s*$/.exec(from);
  return (m?.[1] ?? new URL(SITE_URL).hostname.replace(/^www\./, "")).toLowerCase();
}

async function txt(name: string): Promise<string[] | null> {
  const r = await withTimeout(resolveTxt(name), 4000);
  return r ? r.map((parts) => parts.join("")) : null;
}

// Resend says the domain is verified; if its API won't say (a key that may
// only send), Resend's signing key being in our DNS stands in for it.
async function senderVerified(domain: string): Promise<{ ok: boolean | null; detail: string }> {
  const s = senderStatus();
  if (!s.ready) return { ok: false, detail: s.problem ?? "The sender isn't set up." };
  if (!emailTokensReady()) return { ok: false, detail: "EMAIL_TOKEN_SECRET isn't set in Vercel, so emails couldn't carry a working unsubscribe link." };
  const key = process.env.RESEND_API_KEY;
  const res = key
    ? await withTimeout(
        fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(5000) }).then(async (r) =>
          r.ok ? ((await r.json()) as { data?: { name: string; status: string }[] }) : null,
        ),
        6000,
      )
    : null;
  const match = res?.data?.find((d) => domain === d.name.toLowerCase() || domain.endsWith(`.${d.name.toLowerCase()}`));
  if (match) return match.status === "verified" ? { ok: true, detail: `${domain} is verified with Resend.` } : { ok: false, detail: `Resend says ${domain} is "${match.status}", not verified yet.` };
  const dkim = await txt(`resend._domainkey.${domain}`);
  if (dkim === null) return { ok: null, detail: "Couldn't check just now." };
  return dkim.some((t) => t.includes("p=")) ? { ok: true, detail: `Resend's signing key is in ${domain}'s settings.` } : { ok: false, detail: `Resend's signing key isn't in ${domain}'s settings yet.` };
}

export async function goLiveChecklist(): Promise<GoLive> {
  const admin = createAdminClient();
  const domain = sendingDomain();
  const [sender, hook, tested, pictures, sw, dmarc] = await Promise.all([
    senderVerified(domain).catch(() => ({ ok: null, detail: "Couldn't check just now." })),
    admin.from("email_events").select("received_at").not("svix_id", "is", null).order("received_at", { ascending: false }).limit(1),
    admin.from("email_settings").select("value, updated_at").eq("key", UNSUBSCRIBE_TESTED).maybeSingle(),
    picturesCheck().catch(() => null),
    getSendingSwitch().catch(() => ({ on: false, at: null })),
    txt(`_dmarc.${domain}`),
  ]);

  const lastHook = (hook.data?.[0]?.received_at as string | undefined) ?? null;
  const hookFresh = !!lastHook && Date.now() - Date.parse(lastHook) < WEBHOOK_FRESH_DAYS * 86_400_000;
  const t = tested.data?.value as { done?: boolean; at?: string } | undefined;
  const unsubscribeTested = t?.done === true;
  const dmarcRecord = dmarc?.find((r) => /^v=DMARC1/i.test(r.trim())) ?? null;
  const policy = dmarcRecord ? (/\bp=(\w+)/i.exec(dmarcRecord)?.[1] ?? "?") : null;
  const masterOn = masterSettingOn();

  const items: GoLiveItem[] = [
    {
      key: "sender",
      label: "Sender verified",
      ok: sender.ok,
      about: "Our emails come from an address at our own website name, and our email service (Resend) has confirmed it's really ours, so inboxes trust it.",
      detail: sender.detail,
    },
    {
      key: "webhook",
      label: "Delivery reports coming in",
      ok: hookFresh,
      about: `Resend tells us what happened to each email (delivered, bounced, marked as spam). The results and the automatic brake need it. Ticks once we've heard in the last ${WEBHOOK_FRESH_DAYS} days.`,
      detail: lastHook ? `Last heard ${when(lastHook)}.` : "Not heard from yet. Any email at all (a receipt is enough) should bring the first report within minutes.",
    },
    {
      key: "unsubscribe",
      label: "Unsubscribe link tried",
      ok: unsubscribeTested,
      about: "Send yourself a test from Ready to send, tap Unsubscribe at the bottom, check it works, then switch your own email back on. Tick it here once done.",
      detail: unsubscribeTested && t?.at ? `Ticked ${when(t.at)}.` : null,
    },
    {
      key: "pictures",
      label: "Email pictures uploaded",
      ok: pictures ? pictures.missing.length === 0 : null,
      about: "The pictures in the three ready-made emails are on our picture server, so nobody opens an email full of broken images.",
      detail: !pictures
        ? "Couldn't check just now."
        : pictures.missing.length === 0
          ? `All ${pictures.expected} are there.`
          : `${pictures.missing.length} of ${pictures.expected} are missing. A developer puts them up with scripts/email-designs/upload.mjs.`,
    },
    {
      key: "master",
      label: "Master setting on (Vercel)",
      ok: masterOn,
      about: "The top-level setting in our hosting (Vercel). An owner turns it on once there and redeploys. While it's off, nothing goes to a list, whatever the switch below says.",
      detail: masterOn ? "On." : "Off.",
    },
    {
      key: "switch",
      label: "Sending switched on (Back office)",
      ok: sw.on,
      about: "The everyday on/off switch below. Owners can flip it any time and it works at once. Receipts, password resets and sign-up links aren't affected by it.",
      detail: `${sw.on ? "On" : "Off"}${sw.at ? ` since ${when(sw.at)}` : ""}.`,
    },
    {
      key: "dmarc",
      label: "Anti-fake-email record (DMARC)",
      ok: dmarc === null ? null : !!dmarcRecord,
      about: "A public note in our website's settings telling Gmail and Yahoo what to do with email that only pretends to come from us. They expect it from anyone sending to lists.",
      detail: dmarc === null ? "Couldn't check just now." : dmarcRecord ? `Found for ${domain} (policy: ${policy}).` : `No record found for ${domain}.`,
    },
  ];
  return { items, switchOn: sw.on, switchAt: sw.at, masterOn, unsubscribeTested };
}
