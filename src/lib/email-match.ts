// Emails are looked up case-insensitively with ilike, where _ and % are
// wildcards: "j_smith@x.com" would also match "jxsmith@x.com". This escapes
// them so .ilike("email", exactEmail(e)) only ever matches that address.
export function exactEmail(email: string): string {
  return email.trim().replace(/[\\%_]/g, (c) => "\\" + c);
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}
