// Checks safePath (src/lib/safe-path.ts), the guard on every "come back
// here afterwards" redirect: paths on this site pass through, and anything
// a browser would read as another site -- including dot segments that
// collapse into "//evil.example" -- comes back null. No database, no network.
//
// Usage: node scripts/check-safe-path.mjs   (Node 23.6+ runs the .ts directly)
const { safePath } = await import("../src/lib/safe-path.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const refused = (p) => check(`refuses ${JSON.stringify(p)}`, safePath(p) === null, String(safePath(p)));
const kept = (p, want = p) => check(`keeps ${JSON.stringify(p)}`, safePath(p) === want, String(safePath(p)));

// ---------- another site ----------
refused("/.//evil.example");
refused("/..//evil.example");
refused("/%2e//evil.example");
refused("/%2E//evil.example");
refused("/a/..//evil.example");
refused("/a/b/../..//evil.example");
refused("//evil.example");
refused("/\\evil.example");
refused("/%09/evil.example");
refused("/\t/evil.example");
refused("/\n/evil.example");
refused("/\r\n/evil.example");
refused("https://evil.example");
refused("evil.example");

// ---------- nothing to go to ----------
refused("");
refused(null);
refused(undefined);

// ---------- this site ----------
kept("/pos");
kept("/account/claim?t=x");
kept("/showtimes/abc#x");
kept("/");
kept("/admin/reports?day=2026-09-30&tab=tips");
// Dot segments that stay on this site just tidy up.
kept("/a/../pos", "/pos");
kept("/./account", "/account");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
