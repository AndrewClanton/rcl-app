// Checks the organization helper invite (lib/org-invite-server.ts and
// lib/email/org-invite-email.ts) without a database or network: the email
// (subject, one join button with the org's link, "an"/"a", escaping, signed
// "The RCL crew"), a send through the fake Resend logged in
// org_invite_sends, bad addresses and closed organizations refused, and the
// limits (3 an hour to one address, 10 an hour per organization).
// Optionally writes a preview of the email.
//
// Usage: node scripts/check-org-invite.mjs [preview.html]   (Node 22.18+)
import { existsSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = path.join(root, "src");
const fakesUrl = new URL("./check-org-invite-fakes.mjs", import.meta.url).href;
const STUBBED = { "server-only": fakesUrl, "next/headers": fakesUrl, "@/lib/supabase/admin": fakesUrl, "@/lib/auth": fakesUrl };
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = withExt(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(src)) {
        const file = withExt(path.resolve(path.dirname(parent), specifier));
        if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

// A made-up key, in this process only; only the fake Resend answers.
process.env.RESEND_API_KEY = "test-only-not-a-real-key";
const fakes = await import(fakesUrl);
const { db, staff, resend, fakeFetch } = fakes;
globalThis.fetch = fakeFetch;

const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const E = await load("lib/email/org-invite-email.ts");
const S = await load("lib/org-invite-server.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// 1. The email.
const d = { orgName: "Easter Seals", joinUrl: "https://royale.test/account/join?c=abc123" };
const html = E.orgInviteHtml(d);
check("subject", E.orgInviteSubject(d) === "You're invited to join Easter Seals at Royale Cinema");
check("one big join button", html.includes("Join as an Easter Seals helper</a>") && html.includes(`href="${d.joinUrl}"`));
check("a/an", E.withArticle("Arc of the Ozarks") === "an Arc of the Ozarks" && E.withArticle("Joplin Group") === "a Joplin Group");
check("comps line", html.includes("day pass and movies are on Easter Seals"));
check("signed by the crew, no staff name", html.includes("The RCL crew") && !html.includes(staff.name) && !/Andrew/i.test(html));
check("escapes the name", E.orgInviteHtml({ ...d, orgName: "<b>&" }).includes("&lt;b&gt;&amp;") && !E.orgInviteHtml({ ...d, orgName: "<b>" }).includes("<b>"));
if (process.argv[2]) writeFileSync(process.argv[2], html);

// 2. Sending.
const ORG = "a0000000-0000-4000-8000-0000000000a1";
const CLOSED = "a0000000-0000-4000-8000-0000000000a2";
db.organizations.push(
  { id: ORG, name: "Easter Seals", status: "active", invite_code: "abc123" },
  { id: CLOSED, name: "Old Group", status: "closed", invite_code: "def456" },
);
const r = await S.sendOrgInvite(ORG, "  Helper@Work.org ", "register", staff);
check("sends", r.ok && r.orgName === "Easter Seals", JSON.stringify(r));
const last = resend.sent.at(-1);
check("to the address, transactional", last?.to?.[0] === "helper@work.org" && last.tags?.some((t) => t.name === "kind" && t.value === "transactional"));
check("with the org's join link", !!last?.html?.includes("https://royale.test/account/join?c=abc123"));
const row = db.org_invite_sends.at(-1);
check("logged", row?.organization_id === ORG && row.email === "helper@work.org" && row.sent_by === staff.employeeId && row.source === "register");
const log = await S.recentOrgInvites(ORG);
check("log reads back", log.length === 1 && log[0].sentByName === staff.name);
check("bad email refused", !(await S.sendOrgInvite(ORG, "not-an-email", "back_office", staff)).ok);
check("closed org refused", !(await S.sendOrgInvite(CLOSED, "x@y.org", "back_office", staff)).ok);
check("unknown org refused", !(await S.sendOrgInvite("nope", "x@y.org", "back_office", staff)).ok);
const same = [];
for (let i = 0; i < 3; i++) same.push((await S.sendOrgInvite(ORG, "helper@work.org", "back_office", staff)).ok);
check("3 an hour to one address", same.join() === "true,true,false", same.join());
let ok = 0;
for (let i = 0; i < 12; i++) if ((await S.sendOrgInvite(ORG, `h${i}@work.org`, "back_office", staff)).ok) ok++;
check("10 an hour per organization", ok === 7, `${ok} more after 3`);
check("only real sends logged", db.org_invite_sends.length === 10, String(db.org_invite_sends.length));

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
