// Turns a campaign (stored JSON blocks) plus what the database says (films,
// showtimes, house events, menu items) into one person's email: subject,
// preview text, HTML and the plain-text twin.
//
// No server code: the composer's live preview runs this in the browser. The
// sender always rebuilds the email on the server from the stored campaign
// and database rows; nothing is ever sent from HTML a browser supplied.
//
// MPLC: an archive (older) title only ever renders inside the "From the
// film archive" section, with the note asking members not to post it. The
// subject and preview text are checked separately (lint.ts).
import { SITE_URL } from "@/lib/site";
import { BODY, C, DISPLAY, MONO, button, eyebrow, footerHtml, footerText, paragraphsHtml, row, sectionBar, shell } from "./shell";
import { applyFirstName, dayLabel, esc, money, rangeLabel, runtimeLabel, timeLabel } from "./format";
import type { AlertType, CampaignKind, Category, ConsentSource } from "./types";

// ---------- the composer's vocabulary ----------
export type Block =
  | { t: "hero"; eyebrow?: string; headline: string; sub?: string }
  | { t: "paragraph"; text: string }
  | { t: "button"; label: string; link: string; primary?: boolean }
  | { t: "filmCard"; movieId: string }
  | { t: "archiveSection"; movieIds?: string[] }
  | { t: "eventRow"; houseEventId: string }
  | { t: "barNote"; menuItemId?: string | null; line: string }
  | { t: "perks"; kind: "insiders" | "plus" }
  | { t: "ticketStub"; label: string; big: string; sub?: string }
  | { t: "signoff"; from?: string }
  | { t: "divider" }
  | { t: "lineup" } // the week: now showing, the archive, also at the Royale
  | { t: "claim" } // the invite's "Set my password" (a personal link)
  | { t: "memberCard" } // "Open my member card"
  | { t: "ticketSpend" }; // the upsell's "you spent $X on tickets"

export type BlockType = Block["t"];

export interface LineupConfig {
  start: string; // YYYY-MM-DD business date
  days: number;
  skipMovieIds: string[];
  skipHappeningIds: string[];
  featuredMovieId?: string | null;
}

export interface CampaignContent {
  blocks: Block[];
  lineup?: LineupConfig;
  // Which showtimes film cards and the archive section show (non-lineup).
  window?: { start: string; days: number };
  alert?: AlertType;
  eventDate?: string | null; // for "came in after": the event's day
  autopilot?: boolean; // the Monday lineup draft, not yet touched by a person
}

export interface ShowtimeData {
  id: string;
  startsAt: string;
}

export interface FilmData {
  movieId: string;
  title: string;
  posterUrl: string | null;
  rating: string | null;
  runtime: number | null;
  archive: boolean;
  showtimes: ShowtimeData[];
}

export interface HappeningData {
  id: string;
  title: string;
  note: string | null;
  startsAt: string;
}

export interface MenuItemData {
  id: string;
  name: string;
  price: number;
}

export interface RenderData {
  range: { start: string; days: number };
  films: FilmData[];
  happenings: HappeningData[];
  menuItems: MenuItemData[];
}

export interface Recipient {
  firstName: string | null;
  consentSource: ConsentSource;
  tier: string;
  hasLogin: boolean;
  email: string | null; // their own address, for the invite's "set up under ..."
  claimUrl: string | null;
  ticketSpend30?: number;
  paidTickets30?: number;
}

export interface RenderLinks {
  preferencesUrl: string;
  unsubscribeUrl: string;
  // Turns a link into what goes in the email (a tracked /e/<send>/<i>
  // address when sending, the link itself in a preview).
  href: (url: string, label: string) => string;
}

export interface CampaignInput {
  kind: CampaignKind;
  category: Category;
  subject: string;
  preheader: string | null;
  content: CampaignContent;
}

export interface RenderMeta {
  primaryButtons: number;
  plainFilms: { title: string; archive: boolean }[];
  bodyTexts: string[];
  containsArchive: boolean;
  houseEventIds: string[];
}

export interface Rendered {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  meta: RenderMeta;
}

// ---------- links ----------
// A link typed in the composer: a path on our site ("/showtimes") or a
// full https address. Anything else becomes the showtimes page.
export function resolveLink(link: string): string {
  const l = (link ?? "").trim();
  if (l.startsWith("/") && !l.startsWith("//")) return `${SITE_URL}${l}`;
  if (/^https:\/\/[^\s"'<>]+$/i.test(l)) return l;
  return `${SITE_URL}/showtimes`;
}

export const showtimeUrl = (id: string) => `${SITE_URL}/showtimes/${id}`;
export const calendarUrl = (houseEventId: string) => `${SITE_URL}/api/calendar/${houseEventId}`;

// ---------- the footer's "why you're getting this" ----------
export function whyLine(kind: CampaignKind, consent: ConsentSource): string {
  if (kind === "invite") return "You're getting this because you had an account at royalecinemajoplin.com.";
  if (consent === "old_site_import") return "You're getting this because you're a Royale Insider: your account moved over from our old website, and you never had to tick a box for it.";
  if (consent === "indy_yes") return "You're getting this because you're a Royale Insider and said yes to Royale emails when you bought tickets from us.";
  return "You're getting this because you're a Royale Insider.";
}

// ---------- pieces ----------
function byDay(showtimes: ShowtimeData[]) {
  const days: { day: string; times: ShowtimeData[] }[] = [];
  for (const s of [...showtimes].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = dayLabel(s.startsAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.times.push(s);
    else days.push({ day, times: [s] });
  }
  return days;
}

const metaLine = (f: FilmData) => [f.rating || "NR", runtimeLabel(f.runtime)].filter(Boolean).join(" · ");

function filmRowHtml(f: FilmData, first: boolean, L: RenderLinks, tag?: string): string {
  const link = f.showtimes[0] ? L.href(showtimeUrl(f.showtimes[0].id), `${f.title} poster`) : L.href(`${SITE_URL}/showtimes`, "All showtimes");
  const poster = f.posterUrl
    ? `<td class="poster" width="92" valign="top" style="width:92px;padding-right:16px;"><a href="${esc(link)}"><img src="${esc(f.posterUrl)}" width="92" alt="${esc(f.title)}" style="display:block;width:92px;height:auto;border:2px solid ${C.ink};"></a></td>`
    : "";
  const days = byDay(f.showtimes)
    .map(
      (d) => `<tr>
<td valign="top" style="padding:8px 10px 0 0;white-space:nowrap;font-family:${MONO};font-size:11px;line-height:36px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted};">${esc(d.day)}</td>
<td valign="top" style="padding-top:8px;">${d.times
        .map(
          (t) =>
            `<a href="${esc(L.href(showtimeUrl(t.id), `${f.title} ${d.day} ${timeLabel(t.startsAt)}`))}" style="display:inline-block;margin:0 6px 6px 0;padding:9px 12px;border:2px solid ${C.ink};border-radius:4px;background:${C.white};color:${C.ink};font-family:${BODY};font-size:15px;line-height:16px;font-weight:700;text-decoration:none;">${esc(timeLabel(t.startsAt))}</a>`,
        )
        .join("")}</td>
</tr>`,
    )
    .join("");
  return `<tr><td class="px" style="padding:20px 28px;${first ? "" : `border-top:1px solid ${C.line};`}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${poster}
<td valign="top">
${tag ? `<div style="padding-bottom:6px;"><span style="display:inline-block;background:${C.gold};color:${C.ink};font-family:${MONO};font-size:11px;line-height:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:3px 7px;border:1px solid ${C.ink};">${esc(tag)}</span></div>` : ""}
<div style="font-family:${DISPLAY};font-size:21px;line-height:25px;color:${C.ink};">${esc(f.title)}</div>
<div style="padding-top:5px;font-family:${MONO};font-size:11px;line-height:15px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted};">${esc(metaLine(f))}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;">${days}</table>
</td>
</tr></table>
</td></tr>`;
}

function filmText(f: FilmData, L: RenderLinks): string {
  return [
    `${f.title} (${[f.rating || "NR", runtimeLabel(f.runtime)].filter(Boolean).join(", ")})`,
    ...byDay(f.showtimes).map((d) => `  ${d.day}: ${d.times.map((t) => timeLabel(t.startsAt)).join(", ")}`),
    `  Tickets: ${f.showtimes[0] ? L.href(showtimeUrl(f.showtimes[0].id), `${f.title} poster`) : L.href(`${SITE_URL}/showtimes`, "All showtimes")}`,
  ].join("\n");
}

export const ARCHIVE_NOTE = "For Insiders only: our license lets us tell members about these older titles, not the public, so please don't post or share them.";

function archiveHtml(films: FilmData[], L: RenderLinks): string {
  if (!films.length) return "";
  return (
    sectionBar("From the film archive") +
    `<tr><td class="px" style="padding:16px 28px 0;font-family:${BODY};font-size:14px;line-height:21px;color:${C.muted};">${esc(ARCHIVE_NOTE)}</td></tr>` +
    films.map((f, i) => filmRowHtml(f, i === 0, L)).join("")
  );
}

function archiveText(films: FilmData[], L: RenderLinks): string {
  if (!films.length) return "";
  return ["FROM THE FILM ARCHIVE", ARCHIVE_NOTE, "", films.map((f) => filmText(f, L)).join("\n\n")].join("\n");
}

function happeningHtml(h: HappeningData, first: boolean, L: RenderLinks): string {
  return `<tr><td class="px" style="padding:16px 28px;${first ? "" : `border-top:1px solid ${C.line};`}">
<div style="font-family:${MONO};font-size:11px;line-height:15px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted};">${esc(dayLabel(h.startsAt))} &middot; ${esc(timeLabel(h.startsAt))}</div>
<div style="padding-top:4px;font-family:${DISPLAY};font-size:19px;line-height:23px;color:${C.ink};">${esc(h.title)}</div>
${h.note ? `<div style="padding-top:4px;font-family:${BODY};font-size:15px;line-height:22px;color:${C.ink};">${esc(h.note)}</div>` : ""}
<div style="padding-top:8px;font-family:${BODY};font-size:14px;line-height:20px;"><a href="${esc(L.href(calendarUrl(h.id), `Calendar: ${h.title}`))}" style="color:${C.red};font-weight:700;text-decoration:underline;">Add to my calendar</a></div>
</td></tr>`;
}

function happeningText(h: HappeningData, L: RenderLinks): string {
  return `${dayLabel(h.startsAt)}, ${timeLabel(h.startsAt)}: ${h.title}${h.note ? ` (${h.note})` : ""}\n  Add to my calendar: ${L.href(calendarUrl(h.id), `Calendar: ${h.title}`)}`;
}

// The money off matches the register (memberDiscountRate in pos/PosApp.tsx):
// 5% for Insiders, 10% for Insiders+, on the whole order.
const INSIDER_PERKS: [string, string][] = [
  ["5% off everything", "Scan your member card at the register and 5% comes off the whole order: bar, kitchen and box office."],
  ["Points on everything", "1 point for every $1 at the bar, kitchen and box office. 100 points = $5 off."],
  ["Check in, get points", "Scan in at the door: every visit earns 5 points, and badges earn more."],
  ["The weekly lineup", "Every week's films, including the Film Archive classics we only share with members."],
];
const PLUS_PERKS = ["Free entry to every screening", "2 free booth reservations a month", "10% off everything at the register", "First dibs on special events"];

function perksHtml(kind: "insiders" | "plus", L: RenderLinks): string {
  if (kind === "insiders") {
    return row(
      `${eyebrow("What Insiders get", C.muted)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
${INSIDER_PERKS.map(
  ([label, text], i) => `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ""}">
<div style="font-family:${BODY};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};">${esc(label)}</div>
<div style="font-family:${BODY};font-size:15px;line-height:22px;color:${C.muted};padding-top:2px;">${esc(text)}</div>
</td></tr>`,
).join("")}
</table>`,
    );
  }
  return `<tr><td class="px" bgcolor="${C.ink}" style="background:${C.ink};padding:30px 28px 32px;">
${eyebrow("Insiders+", C.gold)}
<div class="h1" style="padding-top:10px;font-family:${DISPLAY};font-size:27px;line-height:31px;color:${C.cream};">Stop buying tickets. Walk in free, every time.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
${PLUS_PERKS.map(
  (t) =>
    `<tr><td width="22" valign="top" style="width:22px;padding:5px 0;font-family:${BODY};font-size:16px;line-height:22px;color:${C.gold};font-weight:700;">&#10003;</td><td style="padding:5px 0;font-family:${BODY};font-size:16px;line-height:22px;color:${C.cream};">${esc(t)}</td></tr>`,
).join("")}
</table>
<div style="padding-top:16px;font-family:${MONO};font-size:13px;line-height:19px;font-weight:700;color:${C.gold};letter-spacing:1px;">$15 A MONTH OR $153 A YEAR</div>
<div style="padding-top:6px;font-family:${BODY};font-size:13px;line-height:19px;color:${C.inkMuted};">Tickets are $8, so two movies a month covers it. Senior and student rates are set at the box office with an ID.</div>
<div style="padding-top:18px;"><a href="${esc(L.href(`${SITE_URL}/membership#join`, "Insiders+"))}" style="color:${C.gold};font-family:${BODY};font-size:16px;font-weight:700;text-decoration:underline;">How Insiders+ works &rarr;</a></div>
</td></tr>`;
}

function perksText(kind: "insiders" | "plus", L: RenderLinks): string {
  if (kind === "insiders") return ["WHAT INSIDERS GET", ...INSIDER_PERKS.map(([l, t]) => `- ${l}: ${t}`)].join("\n");
  return [
    "INSIDERS+: Stop buying tickets. Walk in free, every time.",
    ...PLUS_PERKS.map((t) => `- ${t}`),
    "$15 a month or $153 a year. Tickets are $8, so two movies a month covers it.",
    `How Insiders+ works: ${L.href(`${SITE_URL}/membership#join`, "Insiders+")}`,
  ].join("\n");
}

function ticketStubHtml(b: { label: string; big: string; sub?: string }): string {
  return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.gold}" style="background:${C.gold};border:2px solid ${C.ink};border-radius:10px;">
<tr><td class="gift" valign="middle" style="padding:20px 22px;">
${eyebrow(b.label, C.ink)}
<div style="font-family:${DISPLAY};font-size:36px;line-height:40px;color:${C.ink};padding-top:6px;">${esc(b.big)}</div>
${b.sub ? `<div style="font-family:${BODY};font-size:15px;line-height:22px;color:${C.ink};padding-top:4px;">${esc(b.sub)}</div>` : ""}
</td></tr></table>`);
}

// ---------- the whole email ----------
function heroHtml(b: { eyebrow?: string; headline: string; sub?: string }): string {
  return `<tr><td class="px" bgcolor="${C.gold}" style="background:${C.gold};padding:26px 28px 24px;border-bottom:3px solid ${C.ink};">
${b.eyebrow ? eyebrow(b.eyebrow, C.ink) : ""}
<div class="h1" style="padding-top:${b.eyebrow ? 10 : 0}px;font-family:${DISPLAY};font-size:34px;line-height:38px;color:${C.ink};">${esc(b.headline)}</div>
${b.sub ? `<div style="padding-top:10px;font-family:${BODY};font-size:17px;line-height:25px;font-weight:700;color:${C.ink};">${esc(b.sub)}</div>` : ""}
</td></tr>`;
}

export function lineupFilms(content: CampaignContent, data: RenderData) {
  const skip = new Set(content.lineup?.skipMovieIds ?? []);
  const films = data.films.filter((f) => f.showtimes.length && !skip.has(f.movieId));
  const featured = content.lineup?.featuredMovieId ?? null;
  const current = films.filter((f) => !f.archive).sort((a, b) => (a.movieId === featured ? -1 : b.movieId === featured ? 1 : 0));
  const archive = films.filter((f) => f.archive);
  const skipH = new Set(content.lineup?.skipHappeningIds ?? []);
  const happenings = data.happenings.filter((h) => !skipH.has(h.id));
  return { current, archive, happenings, featured };
}

// This year's titles only, for the subject and the preview text.
export function defaultLineupSubject(content: CampaignContent, data: RenderData): string {
  const { current } = lineupFilms(content, data);
  const names = current.slice(0, 3).map((f) => f.title);
  return names.length ? `This week at the Royale: ${names.join(", ")}` : `This week at the Royale: ${rangeLabel(data.range.start, data.range.days)}`;
}

export function defaultLineupPreheader(content: CampaignContent, data: RenderData): string {
  const { archive } = lineupFilms(content, data);
  return `37 seats a show, so tap a time early.${archive.length ? " The members-only classics are inside." : ""}`;
}

export function renderCampaign(c: CampaignInput, data: RenderData, r: Recipient, L: RenderLinks): Rendered {
  const name = r.firstName;
  const merge = (s: string) => applyFirstName(s, name);
  const html: string[] = [];
  const text: string[] = [];
  const meta: RenderMeta = { primaryButtons: 0, plainFilms: [], bodyTexts: [], containsArchive: false, houseEventIds: [] };
  const filmById = new Map(data.films.map((f) => [f.movieId, f]));
  const happeningById = new Map(data.happenings.map((h) => [h.id, h]));
  const itemById = new Map(data.menuItems.map((m) => [m.id, m]));

  const subject = merge(c.subject.trim() || (c.kind === "lineup" ? defaultLineupSubject(c.content, data) : "News from the Royale"));
  const preheader = merge((c.preheader ?? "").trim() || (c.kind === "lineup" ? defaultLineupPreheader(c.content, data) : ""));

  for (const b of c.content.blocks ?? []) {
    switch (b.t) {
      case "hero": {
        const h = { eyebrow: b.eyebrow ? merge(b.eyebrow) : undefined, headline: merge(b.headline), sub: b.sub ? merge(b.sub) : undefined };
        meta.bodyTexts.push(h.eyebrow ?? "", h.headline, h.sub ?? "");
        html.push(heroHtml(h));
        text.push([h.eyebrow?.toUpperCase(), h.headline.toUpperCase(), h.sub].filter(Boolean).join("\n"));
        break;
      }
      case "paragraph": {
        const t = merge(b.text);
        if (!t.trim()) break;
        meta.bodyTexts.push(t);
        html.push(row(paragraphsHtml(t), "padding:20px 28px 6px;"));
        text.push(t.trim());
        break;
      }
      case "button": {
        const primary = b.primary !== false;
        if (primary) meta.primaryButtons++;
        const label = merge(b.label || "See what's on");
        meta.bodyTexts.push(label);
        const href = L.href(resolveLink(b.link), label);
        html.push(row(button(href, label, primary), "padding:8px 28px 20px;"));
        text.push(`${label}: ${href}`);
        break;
      }
      case "filmCard": {
        const f = filmById.get(b.movieId);
        if (!f) break;
        meta.plainFilms.push({ title: f.title, archive: f.archive });
        // An archive film never gets an ordinary card, even if one was
        // stored: it goes to its members-only section instead.
        if (f.archive) {
          meta.containsArchive = true;
          html.push(archiveHtml([f], L));
          text.push(archiveText([f], L));
        } else {
          html.push(filmRowHtml(f, true, L));
          text.push(filmText(f, L));
        }
        break;
      }
      case "archiveSection": {
        const ids = b.movieIds?.length ? new Set(b.movieIds) : null;
        const films = data.films.filter((f) => f.archive && f.showtimes.length && (!ids || ids.has(f.movieId)));
        if (!films.length) break;
        meta.containsArchive = true;
        html.push(archiveHtml(films, L));
        text.push(archiveText(films, L));
        break;
      }
      case "eventRow": {
        meta.houseEventIds.push(b.houseEventId);
        const h = happeningById.get(b.houseEventId);
        if (!h) break;
        html.push(happeningHtml(h, true, L));
        text.push(happeningText(h, L));
        break;
      }
      case "barNote": {
        const item = b.menuItemId ? itemById.get(b.menuItemId) : null;
        const line = merge(b.line || "");
        if (!line && !item) break;
        meta.bodyTexts.push(line);
        html.push(
          row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${C.ink};border-radius:6px;background:${C.cream};"><tr><td style="padding:16px 18px;">
${eyebrow("At the bar", C.red)}
${item ? `<div style="padding-top:6px;font-family:${DISPLAY};font-size:18px;line-height:22px;color:${C.ink};">${esc(item.name)}${item.price > 0 ? ` &middot; ${esc(money(item.price))}` : ""}</div>` : ""}
${line ? `<div style="padding-top:4px;font-family:${BODY};font-size:15px;line-height:22px;color:${C.ink};">${esc(line)}</div>` : ""}
</td></tr></table>`,
            "padding:14px 28px;",
          ),
        );
        text.push(`AT THE BAR: ${[item ? `${item.name}${item.price > 0 ? ` (${money(item.price)})` : ""}` : "", line].filter(Boolean).join(". ")}`);
        break;
      }
      case "perks":
        html.push(perksHtml(b.kind, L));
        text.push(perksText(b.kind, L));
        break;
      case "ticketStub": {
        const s = { label: merge(b.label), big: merge(b.big), sub: b.sub ? merge(b.sub) : undefined };
        meta.bodyTexts.push(s.label, s.big, s.sub ?? "");
        html.push(ticketStubHtml(s));
        text.push(`${s.label.toUpperCase()}: ${s.big}${s.sub ? `. ${s.sub}` : ""}`);
        break;
      }
      case "signoff": {
        const from = b.from?.trim() || "The Royale crew";
        html.push(row(`<div style="font-family:${BODY};font-size:16px;line-height:24px;color:${C.ink};">See you at the movies,<br><strong>${esc(from)}</strong></div>`, "padding:10px 28px 26px;"));
        text.push(`See you at the movies,\n${from}`);
        break;
      }
      case "divider":
        html.push(`<tr><td style="padding:0 28px;"><div style="border-top:2px dashed ${C.line};height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>`);
        text.push("----");
        break;
      case "lineup": {
        const { current, archive, happenings, featured } = lineupFilms(c.content, data);
        if (current.length) {
          html.push(sectionBar("Now showing"), ...current.map((f, i) => filmRowHtml(f, i === 0, L, f.movieId === featured ? "This week's pick" : undefined)));
          text.push(["NOW SHOWING", "", current.map((f) => filmText(f, L)).join("\n\n")].join("\n"));
        }
        if (archive.length) {
          meta.containsArchive = true;
          html.push(archiveHtml(archive, L));
          text.push(archiveText(archive, L));
        }
        if (happenings.length) {
          html.push(sectionBar("Also at the Royale"), ...happenings.map((h, i) => happeningHtml(h, i === 0, L)));
          text.push(["ALSO AT THE ROYALE", "", happenings.map((h) => happeningText(h, L)).join("\n")].join("\n"));
        }
        if (!current.length && !archive.length && !happenings.length) {
          html.push(row(paragraphsHtml("No showtimes picked for these dates yet.", { color: C.muted })));
          text.push("No showtimes picked for these dates yet.");
        }
        html.push(row(button(L.href(`${SITE_URL}/showtimes`, "All showtimes"), "All showtimes", false), "padding:18px 28px 22px;border-top:3px solid " + C.ink + ";"));
        text.push(`All showtimes: ${L.href(`${SITE_URL}/showtimes`, "All showtimes")}`);
        break;
      }
      case "claim": {
        meta.primaryButtons++;
        const [href, label, note] = r.claimUrl
          ? [r.claimUrl, "Set my password", "Takes about 30 seconds. This link is just for you and works for 30 days."]
          : r.hasLogin
            ? [L.href(`${SITE_URL}/account`, "Open my account"), "Open my account", "You're already set up: sign in any time to see your points."]
            : [L.href(`${SITE_URL}/account/login`, "Set up my login"), "Set up my login", "Use this email address and it finds your account."];
        const setUp = r.email ? `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:24px;color:${C.ink};">Your account is set up under <strong>${esc(r.email)}</strong>.</p>` : "";
        html.push(
          row(
            `${setUp}${button(href, label)}<p style="margin:0;padding-top:12px;font-family:${BODY};font-size:13px;line-height:19px;color:${C.muted};">${esc(note)}</p>`,
            "padding:16px 28px 22px;",
          ),
        );
        text.push(`${r.email ? `Your account is set up under ${r.email}.\n` : ""}${label}: ${href}\n${note}`);
        break;
      }
      case "memberCard": {
        meta.primaryButtons++;
        const href = L.href(`${SITE_URL}/account`, "Open my member card");
        html.push(row(button(href, "Open my member card"), "padding:12px 28px 20px;"));
        text.push(`Open my member card: ${href}`);
        break;
      }
      case "ticketSpend": {
        const spend = r.ticketSpend30 ?? 0;
        const n = r.paidTickets30 ?? 0;
        const line =
          n > 0
            ? `You've bought ${n} ticket${n === 1 ? "" : "s"} in the last 30 days (${money(Math.round(spend * 100) / 100)}). Insiders+ is $15 a month and every screening is free.`
            : "Tickets are $8, so two movies a month and Insiders+ has paid for itself.";
        html.push(row(paragraphsHtml(line), "padding:20px 28px 6px;"));
        text.push(line);
        break;
      }
    }
  }

  const promotional = c.category !== "account";
  const footer = { preferencesUrl: L.preferencesUrl, unsubscribeUrl: L.unsubscribeUrl, why: whyLine(c.kind, r.consentSource), promotional };
  return {
    subject,
    preheader,
    html: shell({ subject, preheader, rows: html.join("\n") + footerHtml(footer) }),
    text: [...text, "", footerText(footer)].join("\n\n").replace(/\n{3,}/g, "\n\n"),
    meta,
  };
}

// Every block type, for the composer's "Add a block".
export const BLOCK_CHOICES: { t: BlockType; label: string }[] = [
  { t: "hero", label: "Headline panel" },
  { t: "paragraph", label: "Paragraph" },
  { t: "button", label: "Button" },
  { t: "filmCard", label: "Film with showtimes" },
  { t: "archiveSection", label: "From the film archive (members only)" },
  { t: "eventRow", label: "House event" },
  { t: "barNote", label: "Bar note" },
  { t: "perks", label: "Perks list" },
  { t: "ticketStub", label: "Gold ticket" },
  { t: "memberCard", label: "Member card button" },
  { t: "claim", label: "Set-my-password button (invite)" },
  { t: "ticketSpend", label: "Their ticket spend (upsell)" },
  { t: "lineup", label: "The week's lineup" },
  { t: "divider", label: "Divider" },
  { t: "signoff", label: "Sign-off" },
];

export function newBlock(t: BlockType): Block {
  switch (t) {
    case "hero":
      return { t, eyebrow: "", headline: "Headline", sub: "" };
    case "paragraph":
      return { t, text: "" };
    case "button":
      return { t, label: "See what's playing", link: "/showtimes", primary: true };
    case "filmCard":
      return { t, movieId: "" };
    case "archiveSection":
      return { t, movieIds: [] };
    case "eventRow":
      return { t, houseEventId: "" };
    case "barNote":
      return { t, menuItemId: null, line: "" };
    case "perks":
      return { t, kind: "insiders" };
    case "ticketStub":
      return { t, label: "Welcome gift", big: "50 points", sub: "" };
    case "signoff":
      return { t, from: "The Royale crew" };
    case "divider":
    case "lineup":
    case "claim":
    case "memberCard":
    case "ticketSpend":
      return { t };
  }
}

// Every film, house event and menu item the blocks point at.
export function referencedIds(content: CampaignContent) {
  const movies = new Set<string>();
  const events = new Set<string>();
  const items = new Set<string>();
  for (const b of content.blocks ?? []) {
    if (b.t === "filmCard" && b.movieId) movies.add(b.movieId);
    if (b.t === "archiveSection") for (const id of b.movieIds ?? []) movies.add(id);
    if (b.t === "eventRow" && b.houseEventId) events.add(b.houseEventId);
    if (b.t === "barNote" && b.menuItemId) items.add(b.menuItemId);
  }
  return { movies: [...movies], events: [...events], items: [...items] };
}
