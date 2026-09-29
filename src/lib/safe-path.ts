// A "come back here afterwards" path from a URL parameter, only if it's a
// path on this site -- never another site (//evil.com, /\evil.com, https:).
// Browsers silently drop tabs and newlines inside a URL, so "/<tab>/evil.com"
// turns into "//evil.com" after the check; control characters are refused
// outright, and the path has to still resolve to this site.
export function safePath(p: string | null | undefined): string | null {
  if (!p || !p.startsWith("/")) return null;
  for (const ch of p) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127 || ch === "\\") return null;
  }
  const base = "https://this-site.invalid";
  try {
    const u = new URL(p, base);
    return u.origin === base ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}
