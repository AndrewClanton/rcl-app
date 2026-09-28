// A "come back here afterwards" path from a URL parameter, only if it's a
// path on this site -- never another site (//evil.com, /\evil.com, https:).
export function safePath(p: string | null | undefined): string | null {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return null;
  return p;
}
