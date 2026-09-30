// Small text helpers for email, safe in the browser (the composer's live
// preview renders with the same code the sender uses).

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Any email address in a message from Resend or a mailbox (bounce text,
// an error) becomes "[address]", so nothing we store holds one.
const ADDRESS = /[^\s<>@"'(),;:]+@[^\s<>@"'(),;:]+/g;
export const scrubAddresses = (s: string | undefined | null) => (s ?? "").replace(ADDRESS, "[address]").slice(0, 300);

// The first name we greet someone by ("Hi Sam,"). Anything that could read
// as markup or a template tag is stripped, and a name typed all in capitals
// or all in lower case gets a capital first letter only. Null when there's
// nothing usable (then the email says "there").
export function firstNameOf(name: string | null | undefined): string | null {
  const raw = (name ?? "").trim();
  if (!raw || /^removed member$/i.test(raw)) return null;
  let first = raw.split(/\s+/)[0].replace(/[<>&"'{}\\|`$]/g, "").slice(0, 40);
  if (!first || !/\p{L}/u.test(first)) return null;
  if (first === first.toUpperCase() || first === first.toLowerCase()) first = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return first;
}

// The only merge field: {first name}. With no name, the field goes and the
// sentence is tidied ("{first name}, it's your week." -> "It's your week.",
// "Welcome in, {first name}." -> "Welcome in.").
export const FIRST_NAME_FIELD = /\{\s*first[ _]?name\s*\}/i;

export function applyFirstName(text: string, firstName: string | null): string {
  if (!FIRST_NAME_FIELD.test(text)) return text;
  if (firstName) return text.replace(new RegExp(FIRST_NAME_FIELD.source, "gi"), firstName);
  // "Hi {first name}," reads best as "Hi there,".
  let out = text.replace(new RegExp(`\\b(hi|hey|hello|dear)(\\s+)${FIRST_NAME_FIELD.source}`, "gi"), "$1$2there");
  if (!FIRST_NAME_FIELD.test(out)) return out;
  out = out
    .replace(new RegExp(`,\\s*${FIRST_NAME_FIELD.source}`, "gi"), "")
    .replace(new RegExp(`${FIRST_NAME_FIELD.source}\\s*,\\s*`, "gi"), "")
    .replace(new RegExp(`\\s*${FIRST_NAME_FIELD.source}`, "gi"), "")
    .replace(/\s+([.!?,])/g, "$1")
    .trim();
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

// "Oct 13–19", "Sep 29 – Oct 5", "Oct 13" for a single day.
export function rangeLabel(start: string, days: number): string {
  const add = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  const end = add(start, Math.max(1, days) - 1);
  if (end === start) return fmt(start, { month: "short", day: "numeric" });
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${fmt(start, { month: "short", day: "numeric" })}–${fmt(end, { day: "numeric" })}`
    : `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric" })}`;
}

const TZ = "America/Chicago";
export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
export const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });

export function runtimeLabel(min: number | null | undefined): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}
