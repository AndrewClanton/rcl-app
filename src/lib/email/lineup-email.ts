// The weekly lineup email to the members' list. Plain tables and inline
// styles (what Gmail and phone mail apps render), in the Royale print
// palette, like the booth and gift emails.
//
// No server-only imports: the Mailing list page renders its live preview
// in the browser with the same function the server sends with. The server
// always rebuilds the email from the database before sending; it never
// sends HTML that came from the browser.
//
// Older "archive" titles (MPLC: members may be told, the public may not)
// only ever appear in this members' email, in their own section. There's
// deliberately no "view in browser" link or web copy of the email.
import { SITE_URL } from "@/lib/site";

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";
const TZ = "America/Chicago";

export const THEATER_LINE = "Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 · 417-281-4172";

export interface LineupShowtime {
  id: string;
  startsAt: string;
}

export interface LineupFilm {
  movieId: string;
  title: string;
  posterUrl: string | null;
  rating: string | null;
  runtime: number | null;
  archive: boolean; // an older title: members' email only
  showtimes: LineupShowtime[];
}

export interface LineupHappening {
  id: string;
  title: string;
  note: string | null;
  startsAt: string;
}

export interface LineupData {
  rangeStart: string; // YYYY-MM-DD (business date)
  rangeDays: number;
  films: LineupFilm[];
  happenings: LineupHappening[];
}

export interface LineupEmail extends LineupData {
  intro: string;
}

// "broadcast": Resend fills in each member's first name and their own
// unsubscribe link. "preview"/"test": filled in here, for one person.
export type LineupRender = { mode: "broadcast" } | { mode: "preview" | "test"; firstName: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dateOnly(d: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

function addDays(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// "Oct 2–8", "Sep 30 – Oct 6", "Oct 2" for a single day.
export function rangeLabel(start: string, days: number) {
  const end = addDays(start, Math.max(1, days) - 1);
  if (end === start) return dateOnly(start, { month: "short", day: "numeric" });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth
    ? `${dateOnly(start, { month: "short", day: "numeric" })}–${dateOnly(end, { day: "numeric" })}`
    : `${dateOnly(start, { month: "short", day: "numeric" })} – ${dateOnly(end, { month: "short", day: "numeric" })}`;
}

export function defaultLineupSubject(start: string, days: number) {
  return `${days === 7 ? "This week" : "Coming up"} at the Royale: ${rangeLabel(start, days)}`;
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

function runtimeLabel(min: number | null) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

function byDay(showtimes: LineupShowtime[]) {
  const days: { day: string; times: LineupShowtime[] }[] = [];
  for (const s of [...showtimes].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = dayLabel(s.startsAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.times.push(s);
    else days.push({ day, times: [s] });
  }
  return days;
}

const showtimeUrl = (id: string) => `${SITE_URL}/showtimes/${id}`;
const SETTINGS_URL = `${SITE_URL}/account/profile`;

function sectionBar(label: string) {
  return `<tr><td style="background:${INK};padding:12px 22px;font:900 12px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">${esc(label)}</td></tr>`;
}

function filmRow(f: LineupFilm, first: boolean) {
  const meta = [f.rating || "NR", runtimeLabel(f.runtime)].filter(Boolean).join(" · ");
  const link = f.showtimes[0] ? showtimeUrl(f.showtimes[0].id) : `${SITE_URL}/showtimes`;
  const poster = f.posterUrl
    ? `<td width="92" valign="top" style="padding-right:16px"><a href="${esc(link)}"><img src="${esc(f.posterUrl)}" width="92" alt="${esc(f.title)}" style="display:block;width:92px;height:auto;border:2px solid ${INK}"></a></td>`
    : "";
  const days = byDay(f.showtimes)
    .map(
      (d) => `<tr>
        <td valign="top" style="padding:6px 10px 0 0;white-space:nowrap;font:700 11px/26px 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">${esc(d.day)}</td>
        <td valign="top" style="padding-top:6px">${d.times
          .map(
            (t) =>
              `<a href="${esc(showtimeUrl(t.id))}" style="display:inline-block;margin:0 6px 6px 0;padding:5px 9px;border:2px solid ${INK};background:#ffffff;color:${INK};font:700 14px/1.1 Arial,Helvetica,sans-serif;text-decoration:none">${esc(timeLabel(t.startsAt))}</a>`,
          )
          .join("")}</td>
      </tr>`,
    )
    .join("");
  return `<tr><td style="padding:18px 22px;${first ? "" : `border-top:1px solid ${RULE}`}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${poster}
      <td valign="top">
        <div style="font:900 21px/1.15 'Arial Black',Arial,Helvetica,sans-serif;color:${INK}">${esc(f.title)}</div>
        <div style="margin-top:5px;font:700 11px/1.4 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">${esc(meta)}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px">${days}</table>
      </td>
    </tr></table>
  </td></tr>`;
}

function happeningRow(h: LineupHappening, first: boolean) {
  return `<tr><td style="padding:14px 22px;${first ? "" : `border-top:1px solid ${RULE}`}">
    <div style="font:700 11px/1.4 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">${esc(dayLabel(h.startsAt))} · ${esc(timeLabel(h.startsAt))}</div>
    <div style="margin-top:3px;font:900 18px/1.2 Arial,Helvetica,sans-serif;color:${INK}">${esc(h.title)}</div>
    ${h.note ? `<div style="margin-top:3px;font:15px/1.45 Arial,Helvetica,sans-serif;color:${INK}">${esc(h.note)}</div>` : ""}
  </td></tr>`;
}

function introHtml(intro: string) {
  const text = intro.trim() || "Here's what's playing at the Royale. Tap a time to get tickets. Insiders+ members get in free.";
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function lineupEmailHtml(e: LineupEmail, r: LineupRender): string {
  const greetingName = r.mode === "broadcast" ? "{{{contact.first_name|there}}}" : esc(r.firstName || "there");
  const unsubscribeUrl = r.mode === "broadcast" ? "{{{RESEND_UNSUBSCRIBE_URL}}}" : SETTINGS_URL;
  const current = e.films.filter((f) => !f.archive);
  const archive = e.films.filter((f) => f.archive);
  // The inbox preview line: this year's titles only.
  const preheader = current.length ? current.map((f) => f.title).join(" · ") : "This week's showtimes at the Royale";

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${CREAM}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CREAM}">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">Royale Cinema Lounge</td></tr>
      <tr><td style="background:${GOLD};padding:22px;border-bottom:3px solid ${INK}">
        <div style="font:900 30px/1.05 'Arial Black',Arial,Helvetica,sans-serif;color:${INK}">${e.rangeDays === 7 ? "This week at the Royale" : "Coming up at the Royale"}</div>
        <div style="margin-top:8px;font:700 17px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${esc(rangeLabel(e.rangeStart, e.rangeDays))}</div>
      </td></tr>
      <tr><td style="padding:20px 22px 8px">
        <p style="margin:0 0 12px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Hi ${greetingName},</p>
        ${introHtml(e.intro)}
      </td></tr>
      ${current.length ? sectionBar("Now showing") + current.map((f, i) => filmRow(f, i === 0)).join("") : ""}
      ${
        archive.length
          ? sectionBar("From the film archive") +
            `<tr><td style="padding:14px 22px 0;font:14px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">For Insiders only: our license lets us tell members about these older titles, not the public, so please don't post them.</td></tr>` +
            archive.map((f, i) => filmRow(f, i === 0)).join("")
          : ""
      }
      ${e.happenings.length ? sectionBar("Also at the Royale") + e.happenings.map((h, i) => happeningRow(h, i === 0)).join("") : ""}
      <tr><td style="padding:18px 22px 22px;border-top:3px solid ${INK}">
        <a href="${esc(`${SITE_URL}/showtimes`)}" style="display:inline-block;background:${INK};color:${GOLD};font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 18px">All showtimes</a>
      </td></tr>
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:12px/1.6 Arial,Helvetica,sans-serif;color:${MUTED}">
      You're getting this because you asked for the Royale's weekly lineup.
      <a href="${esc(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a> ·
      <a href="${esc(SETTINGS_URL)}" style="color:${MUTED};text-decoration:underline">Email settings</a>
    </div>
    <div style="max-width:560px;margin:8px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">${esc(THEATER_LINE)}</div>
  </td></tr></table>
</body></html>`;
}

// The plain-text copy that goes with the HTML.
export function lineupEmailText(e: LineupEmail, r: LineupRender): string {
  const name = r.mode === "broadcast" ? "{{{contact.first_name|there}}}" : r.firstName || "there";
  const unsubscribe = r.mode === "broadcast" ? "{{{RESEND_UNSUBSCRIBE_URL}}}" : SETTINGS_URL;
  const film = (f: LineupFilm) =>
    [
      `${f.title} (${[f.rating || "NR", runtimeLabel(f.runtime)].filter(Boolean).join(", ")})`,
      ...byDay(f.showtimes).map((d) => `  ${d.day}: ${d.times.map((t) => timeLabel(t.startsAt)).join(", ")}`),
      `  Tickets: ${showtimeUrl(f.showtimes[0]?.id ?? "")}`,
    ].join("\n");
  const current = e.films.filter((f) => !f.archive);
  const archive = e.films.filter((f) => f.archive);
  return [
    `${e.rangeDays === 7 ? "THIS WEEK" : "COMING UP"} AT THE ROYALE: ${rangeLabel(e.rangeStart, e.rangeDays)}`,
    "",
    `Hi ${name},`,
    "",
    e.intro.trim() || "Here's what's playing at the Royale. Insiders+ members get in free.",
    ...(current.length ? ["", "NOW SHOWING", "", current.map(film).join("\n\n")] : []),
    ...(archive.length
      ? ["", "FROM THE FILM ARCHIVE (Insiders only: our license lets us tell members, not the public, so please don't post these)", "", archive.map(film).join("\n\n")]
      : []),
    ...(e.happenings.length
      ? ["", "ALSO AT THE ROYALE", "", e.happenings.map((h) => `${dayLabel(h.startsAt)}, ${timeLabel(h.startsAt)}: ${h.title}${h.note ? ` (${h.note})` : ""}`).join("\n")]
      : []),
    "",
    `All showtimes: ${SITE_URL}/showtimes`,
    "",
    "You're getting this because you asked for the Royale's weekly lineup.",
    `Unsubscribe: ${unsubscribe}`,
    THEATER_LINE,
  ].join("\n");
}
