// Checks emailIsProven (src/lib/member-link.ts): which logins have shown
// they own their email address. It decides whether a login may take over
// an existing member account, be reused as a new hire's staff login, or be
// given staff access without an in-person check. Google or Facebook only
// counts for the very address they gave us -- not a login that signed in
// with Google and then changed its email to someone else's. No database,
// no network: the users below are made up.
//
// Usage: node scripts/check-member-link.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

// member-link.ts also links accounts, which needs the database; those
// imports are stubbed out, since only emailIsProven runs here.
const srcRoot = new URL("../src/", import.meta.url).href;
const stub = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
register(
  stub(
    `const stubs = {
      "server-only": ${JSON.stringify(stub(""))},
      "@/lib/supabase/admin": ${JSON.stringify(stub('export function createAdminClient() { throw new Error("no database in this check"); }'))},
      "@/lib/member-claim-token": ${JSON.stringify(stub("export async function pendingClaimFor() { return null; }"))},
    };
    export async function resolve(s, c, next) {
      if (stubs[s]) return { url: stubs[s], shortCircuit: true };
      return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
    }`,
  ),
);
const { emailIsProven } = await import("../src/lib/member-link.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const AT = "2026-09-30T18:00:00Z";
const user = (over) => ({ id: "0c9f6f0e-3c1a-4d7e-9b2a-5e8f1a2b3c4d", aud: "authenticated", created_at: AT, app_metadata: {}, user_metadata: {}, ...over });
const identity = (provider, email, extra = {}) => ({ provider, identity_data: { email, email_verified: true, ...extra } });
const proven = (label, u) => check(`proven: ${label}`, emailIsProven(u) === true);
const notProven = (label, u) => check(`not proven: ${label}`, emailIsProven(u) === false);

// ---------- Google and Facebook ----------
notProven(
  "Google login whose email was changed to someone else's",
  user({
    email: "someone.else@example.com",
    identities: [identity("google", "signed.in.with@gmail.com")],
    app_metadata: { provider: "google", providers: ["google"] },
  }),
);
notProven(
  "Google login with a changed email, even with an email identity added for the new address",
  user({
    email: "someone.else@example.com",
    identities: [identity("google", "signed.in.with@gmail.com"), identity("email", "someone.else@example.com")],
    app_metadata: { provider: "google", providers: ["google", "email"] },
  }),
);
proven(
  "Google login with the address Google gave",
  user({ email: "person@gmail.com", identities: [identity("google", "person@gmail.com")], app_metadata: { provider: "google", providers: ["google"] } }),
);
proven("Google match ignores case", user({ email: "Person@Gmail.com", identities: [identity("google", "person@gmail.COM")] }));
proven("Facebook login with the address Facebook gave", user({ email: "person@example.com", identities: [identity("facebook", "person@example.com")] }));
notProven("Google said the address isn't verified", user({ email: "person@gmail.com", identities: [identity("google", "person@gmail.com", { email_verified: false })] }));
notProven("another provider with a matching address", user({ email: "person@example.com", identities: [identity("github", "person@example.com")] }));

// ---------- no identities to look at ----------
notProven("no identities, even though providers says google", user({ email: "person@gmail.com", app_metadata: { provider: "google", providers: ["google"] } }));
notProven("empty identities, providers says facebook", user({ email: "person@example.com", identities: [], app_metadata: { providers: ["facebook"] } }));

// ---------- owner vouched, or a confirmation email ----------
proven("owner made the login in person (email_vouched)", user({ email: "new.hire@example.com", app_metadata: { email_vouched: true } }));
proven("email_vouched with no identities at all", user({ email: "new.hire@example.com", identities: undefined, app_metadata: { email_vouched: true, providers: ["email"] } }));
notProven("email_vouched that isn't exactly true", user({ email: "new.hire@example.com", app_metadata: { email_vouched: "true" } }));
proven("clicked a confirmation email we sent", user({ email: "person@example.com", email_confirmed_at: AT, confirmation_sent_at: AT, identities: [identity("email", "person@example.com")] }));

// ---------- password logins ----------
notProven(
  "password sign-up auto-confirmed with no email sent",
  user({ email: "person@example.com", email_confirmed_at: AT, identities: [identity("email", "person@example.com")], app_metadata: { provider: "email", providers: ["email"] } }),
);
notProven("no email at all", user({ email: undefined, identities: [identity("google", "")] }));
notProven("blank email", user({ email: "", app_metadata: { email_vouched: true } }));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
