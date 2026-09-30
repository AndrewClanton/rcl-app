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
    if (u.origin !== base) return null;
    // Dot segments collapse on the way through: "/.//evil.com",
    // "/a/..//evil.com" and "/%2e//evil.com" all come out as "//evil.com",
    // which a browser reads as another site once it's in a Location header.
    const out = u.pathname + u.search + u.hash;
    if (out.startsWith("//") || out.startsWith("/\\")) return null;
    // An encoded control character ("/%09/evil.com") is harmless as it
    // stands, but becomes the tab trick above if anything decodes it later.
    return /%(?:[01][0-9a-f]|7f)/i.test(u.pathname) ? null : out;
  } catch {
    return null;
  }
}
