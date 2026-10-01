// Checks run before an email can be scheduled (errors block it) and shown
// live in the composer (errors and warnings). No server code.
//
// The MPLC rule, in email terms: our license lets us tell members about
// older (archive) titles, never the public. Member emails are members-only,
// but a subject line and the preview text show on lock screens and in
// notifications, so an archive title may never appear there -- checked
// against every restricted title in the film library, not just this week's.
// In the body they belong in the "From the film archive" section.

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export const MAX_HTML_BYTES = 100 * 1024; // Gmail clips at 102 KB, hiding the footer and its unsubscribe link
export const WARN_HTML_BYTES = 90 * 1024;
export const MAX_SUBJECT_WARN = 70;

// Lower case, accents and punctuation gone ("It's" -> "its", "Amélie" -> "amelie").
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Which of `titles` appear in `text` as whole words. Very short titles
// ("It", "Up") come back separately: they match ordinary words, so they
// only warn.
export function findTitles(text: string, titles: string[]): { hits: string[]; maybe: string[] } {
  const hay = ` ${normalizeTitle(text)} `;
  const hits: string[] = [];
  const maybe: string[] = [];
  for (const t of titles) {
    const n = normalizeTitle(t);
    if (!n || !hay.includes(` ${n} `)) continue;
    (n.replace(/^(the|a|an) /, "").length < 4 ? maybe : hits).push(t);
  }
  return { hits: [...new Set(hits)], maybe: [...new Set(maybe)] };
}

export interface LintInput {
  subject: string;
  preheader: string | null;
  // Every text a person typed into the body outside the archive section
  // (hero, paragraphs, buttons, notes).
  bodyTexts: string[];
  primaryButtons: number;
  // Films shown as ordinary film cards (outside the archive section).
  plainFilmTitles: { title: string; archive: boolean }[];
  restrictedTitles: string[];
  htmlBytes: number | null;
  unknownEventIds?: string[];
}

export function lintCampaign(i: LintInput): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const subject = i.subject.trim();

  const inSubject = findTitles(subject, i.restrictedTitles);
  const inPre = findTitles(i.preheader ?? "", i.restrictedTitles);
  for (const t of inSubject.hits) errors.push(`"${t}" is an archive title: it can't be in the subject line (it shows on lock screens). Keep it in the members-only section.`);
  for (const t of inPre.hits) errors.push(`"${t}" is an archive title: it can't be in the preview text. Keep it in the members-only section.`);
  for (const t of [...inSubject.maybe, ...inPre.maybe]) warnings.push(`The subject or preview text may name the archive title "${t}". Double-check it doesn't.`);

  for (const f of i.plainFilmTitles) {
    if (f.archive) errors.push(`"${f.title}" is an archive title: it can only go in the "From the film archive" section, not a regular film card.`);
  }
  const bodyHits = new Set<string>();
  for (const text of i.bodyTexts) for (const t of findTitles(text, i.restrictedTitles).hits) bodyHits.add(t);
  for (const t of bodyHits) warnings.push(`"${t}" (an archive title) is named outside the members-only section. Move it into "From the film archive".`);

  for (const id of i.unknownEventIds ?? []) errors.push(`An event in this email (${id.slice(0, 8)}) isn't a house event. Only trivia, comedy and other house events can go in email, never private bookings.`);

  if (!subject) errors.push("Add a subject line.");
  if (!i.preheader?.trim()) warnings.push("Add preview text: it's the line people read next to the subject.");
  if (subject.length > MAX_SUBJECT_WARN) warnings.push(`The subject is ${subject.length} characters. Phones cut it off around ${MAX_SUBJECT_WARN}.`);
  const shouty = [subject, i.preheader ?? "", ...i.bodyTexts].some((t) => /\b[A-Z]{2,}[!?.,]*\s+[A-Z]{2,}[!?.,]*\s+[A-Z]{2,}\b/.test(t.replace(/\b(PM|AM|MPLC|TV|USA|DVD|VHS|ID|OK)\b/g, "x")));
  if (shouty) warnings.push("There are three or more words in a row in capitals. It reads as shouting (and as spam).");
  const bangs = (subject.match(/!/g)?.length ?? 0) + (i.preheader?.match(/!/g)?.length ?? 0);
  if (bangs > 1) warnings.push("More than one \"!\" in the subject and preview. One at most.");
  if (i.primaryButtons > 1) warnings.push("More than one main button. One job per email: make the others plain links.");

  if (i.htmlBytes !== null) {
    const kb = Math.round(i.htmlBytes / 1024);
    if (i.htmlBytes > MAX_HTML_BYTES) errors.push(`The email is ${kb} KB. Gmail cuts off anything over 102 KB, hiding the unsubscribe link. Take something out.`);
    else if (i.htmlBytes > WARN_HTML_BYTES) warnings.push(`The email is ${kb} KB, close to Gmail's 102 KB cut-off. Consider trimming it.`);
  }
  return { errors, warnings };
}
