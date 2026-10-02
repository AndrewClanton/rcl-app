// "Claim your account" against the live database (src/lib/member-claim.ts
// and the claim_member_account function), with a throwaway member that is
// always deleted at the end, along with its links. Safe to run anytime.
//
//  - Before the member_claims migration (20260929220000): no link is made,
//    nothing throws, and the claim page says "try again" -- so the tablet
//    shows its plain welcome and the receipt prints without a QR code.
//  - After it: kiosk links last 30 minutes and receipt links two weeks; the
//    repeat check holds back a second link; a link goes straight to signing
//    in (no phone digits, no lockout); expired, used, invalid and removed
//    links; and every answer claim_member_account gives. The ones that would attach a
//    login run inside a transaction that is rolled back, using an existing
//    staff login's id, so no login is ever really attached or created.
//
// Usage: node scripts/check-member-claim-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const claim = await import("../src/lib/member-claim.ts");
const tok = await import("../src/lib/member-claim-token.ts");
const { isClaimUrl } = await import("../src/lib/claim-link.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const migrated = (await c.query("select to_regclass('public.member_claims') as t")).rows[0].t !== null;
console.log(migrated ? "member_claims migration is applied: checking links for real.\n" : "member_claims migration isn't applied yet: checking that nothing breaks.\n");

const db = createAdminClient();
const MIN = 60_000;
const DAY = 86_400_000;
const nonces = [];
const tokenOf = (url) => new URL(url).searchParams.get("t");
const row = async (nonce) => (await c.query("select * from member_claims where nonce = $1", [nonce])).rows[0];
const fakeUser = (id, email = "claimcheck@example.invalid") => ({ id, email, user_metadata: {}, app_metadata: {}, identities: [] });
// A link recorded straight in the table (for states the app never makes on purpose).
async function recordLink(memberId, kind, now, extra = {}) {
  const s = tok.sealClaimToken(memberId, kind, now);
  nonces.push(s.nonce);
  const { error } = await db.from("member_claims").insert({ nonce: s.nonce, member_id: memberId, kind, expires_at: new Date(s.exp).toISOString(), ...extra });
  if (error) throw error;
  return s;
}

let memberId = null;
try {
  const { data: m, error } = await db
    .from("members")
    .insert({ name: "Claimcheck Test", phone: "(555) 010-4242", points: 0, tier: "Insiders", email_opt_in: false })
    .select("id")
    .single();
  if (error) throw error;
  memberId = m.id;

  if (!migrated) {
    check("no kiosk link before the migration, and no crash", (await claim.issueClaimLink(memberId, "kiosk")) === null);
    check("no receipt link before the migration", (await claim.issueClaimLink(memberId, "receipt")) === null);
    check("no link with the repeat check either", (await claim.issueClaimLink(memberId, "kiosk", { skipIfIssuedWithinMs: 10 * MIN })) === null);
    const t = tok.sealClaimToken(memberId, "kiosk");
    nonces.push(t.nonce);
    check("claim page says 'try again in a minute'", (await claim.readClaim(t.token)).state === "unavailable");
    check("finishing refuses without breaking", (await claim.claimMemberForUser(fakeUser(randomUUID()), t.token)).ok === false);
    check("sign-in doesn't hold back a new login for a claim", (await tok.pendingClaimFor({ user_metadata: { rcl_claim: t.token } })) === null);
  } else {
    // ---------- making links ----------
    const kioskUrl = await claim.issueClaimLink(memberId, "kiosk");
    check("kiosk link made", isClaimUrl(kioskUrl), kioskUrl ?? "null");
    const kiosk = tok.openClaimToken(tokenOf(kioskUrl));
    nonces.push(kiosk.nonce);
    const kr = await row(kiosk.nonce);
    check("kiosk link recorded once, for this member", kr?.member_id === memberId && kr.kind === "kiosk" && kr.failed_tries === 0 && !kr.used_at);
    const kLife = new Date(kr.expires_at).getTime() - Date.now();
    check("kiosk link lasts 30 minutes", Math.abs(kLife - 30 * MIN) < MIN, `${Math.round(kLife / MIN)} min`);

    const receiptUrl = await claim.issueClaimLink(memberId, "receipt");
    check("receipt link made", isClaimUrl(receiptUrl));
    const receipt = tok.openClaimToken(tokenOf(receiptUrl));
    nonces.push(receipt.nonce);
    const rLife = new Date((await row(receipt.nonce)).expires_at).getTime() - Date.now();
    check("receipt link lasts two weeks", Math.abs(rLife - 14 * DAY) < MIN, `${(rLife / DAY).toFixed(2)} days`);

    check("no second kiosk link within the repeat window", (await claim.issueClaimLink(memberId, "kiosk", { skipIfIssuedWithinMs: 10 * MIN })) === null);
    check("no link for someone who isn't a member", (await claim.issueClaimLink(randomUUID(), "kiosk")) === null);
    check("no link for a junk id or kind", (await claim.issueClaimLink("x", "kiosk")) === null && (await claim.issueClaimLink(memberId, "bogus")) === null);

    // ---------- opening a link: straight to signing in ----------
    const ready = await claim.readClaim(tokenOf(kioskUrl));
    check("claim page opens the link to the first name only", ready.state === "ready" && ready.firstName === "Claimcheck" && !("last4" in ready), JSON.stringify({ state: ready.state, firstName: ready.firstName }));
    check("a new login made from the link is held for the claim", (await tok.pendingClaimFor({ user_metadata: { rcl_claim: tokenOf(kioskUrl) } })) === `/account/claim?t=${tokenOf(kioskUrl)}`);
    check("a junk claim on a login is ignored", (await tok.pendingClaimFor({ user_metadata: { rcl_claim: "junk" } })) === null);
    check("no digits step left to call", !("checkClaimDigits" in claim));

    // Old wrong tries from the digits step no longer lock anything.
    await c.query("update member_claims set failed_tries = 10 where nonce = $1", [receipt.nonce]);
    check("a link with old wrong tries still opens", (await claim.readClaim(tokenOf(receiptUrl))).state === "ready");
    check("and still holds back a new login for the claim", (await tok.pendingClaimFor({ user_metadata: { rcl_claim: tokenOf(receiptUrl) } })) === `/account/claim?t=${tokenOf(receiptUrl)}`);

    // ---------- links that don't work ----------
    const old = await recordLink(memberId, "kiosk", Date.now() - 31 * MIN);
    const expired = await claim.readClaim(old.token);
    check("an expired link says so, and which kind", expired.state === "expired" && expired.kind === "kiosk");
    check("an expired link no longer holds back a new login", (await tok.pendingClaimFor({ user_metadata: { rcl_claim: old.token } })) === null);
    const unrecorded = tok.sealClaimToken(memberId, "receipt");
    check("a link that was never recorded is invalid", (await claim.readClaim(unrecorded.token)).state === "invalid");
    const stranger = tok.sealClaimToken(randomUUID(), "kiosk");
    nonces.push(stranger.nonce);
    await db.from("member_claims").insert({ nonce: stranger.nonce, member_id: memberId, kind: "kiosk", expires_at: new Date(stranger.exp).toISOString() });
    check("a link naming another member than its record is invalid", (await claim.readClaim(stranger.token)).state === "invalid");
    check("junk is invalid", (await claim.readClaim("not-a-token")).state === "invalid");
    const used = await recordLink(memberId, "receipt", Date.now(), { used_at: new Date().toISOString() });
    check("a used link says so", (await claim.readClaim(used.token)).state === "used");

    // ---------- the last step, through the app (answers that change nothing) ----------
    const { rows: ids } = await c.query(`
      select
        (select auth_user_id from employees where role = 'display' and auth_user_id is not null limit 1) as screen,
        (select auth_user_id from members where auth_user_id is not null limit 1) as linked,
        (select e.auth_user_id from employees e where e.auth_user_id is not null and e.role <> 'display'
           and not exists (select 1 from members m where m.auth_user_id = e.auth_user_id) limit 1) as free`);
    const { screen, linked, free } = ids[0];
    const finish = (user, token) => claim.claimMemberForUser(user, token);
    // No digits first: the link alone reaches the checks below.
    check("a login with no email is refused", (await finish(fakeUser(randomUUID(), null), tokenOf(kioskUrl))).reason === "no_email");
    check("an expired link is refused", (await finish(fakeUser(randomUUID()), old.token)).reason === "expired");
    check("junk is refused", (await finish(fakeUser(randomUUID()), "junk")).reason === "invalid");
    if (screen) check("a screen login is refused (screen)", (await finish(fakeUser(screen), tokenOf(kioskUrl))).reason === "screen");
    if (linked) check("a login that has its own account is refused (user_linked)", (await finish(fakeUser(linked), tokenOf(kioskUrl))).reason === "user_linked");
    check("a used link is refused (used)", (await finish(fakeUser(free ?? randomUUID()), used.token)).reason === "used");

    // ---------- claim_member_account itself, rolled back ----------
    const fn = async (nonce, member, user, email = null) => (await c.query("select public.claim_member_account($1, $2, $3, $4) as r", [nonce, member, user, email])).rows[0].r;
    if (!free) console.log("SKIP  attach steps: no staff login without a member account to borrow");
    else {
      await c.query("begin");
      try {
        check("no_claim: a nonce that doesn't exist", (await fn(randomBytes(9).toString("base64url"), memberId, free)) === "no_claim");
        check("no_claim: a link for a different member", (await fn(kiosk.nonce, randomUUID(), free)) === "no_claim");
        check("expired: a link past its time", (await fn(old.nonce, memberId, free)) === "expired");
        check("used: a link already used", (await fn(used.nonce, memberId, free)) === "used");
        if (screen) check("screen: a signage login", (await fn(kiosk.nonce, memberId, screen)) === "screen");
        if (linked) check("user_linked: a login with its own account", (await fn(kiosk.nonce, memberId, linked)) === "user_linked");
        check("linked: attaches the login", (await fn(kiosk.nonce, memberId, free)) === "linked");
        const after = (await c.query("select auth_user_id, email from members where id = $1", [memberId])).rows[0];
        check("  the account has the login, and no email was invented", after.auth_user_id === free && after.email === null);
        const k2 = await row(kiosk.nonce);
        check("  the link is marked used, by that login", !!k2.used_at && k2.used_by_auth_user === free);
        check("mine: the same login again (a double tap)", (await fn(kiosk.nonce, memberId, free)) === "mine");
        const other = (await c.query("select id from auth.users where id <> $1 limit 1", [free])).rows[0]?.id;
        if (other) check("has_login: another login on an account that has one", (await fn(receipt.nonce, memberId, other)) === "has_login");
      } finally {
        await c.query("rollback");
      }

      await c.query("begin");
      try {
        const email = `claimcheck-${randomUUID()}@example.invalid`;
        check("linked_email: a proven email is saved on an account with none", (await fn(kiosk.nonce, memberId, free, email)) === "linked_email");
        check("  the email is on the account", (await c.query("select email from members where id = $1", [memberId])).rows[0].email === email);
      } finally {
        await c.query("rollback");
      }

      await c.query("begin");
      try {
        const taken = (await c.query("select email from members where email is not null and id <> $1 limit 1", [memberId])).rows[0]?.email;
        if (taken) {
          check("linked: an email another account has isn't copied", (await fn(kiosk.nonce, memberId, free, taken.toUpperCase())) === "linked");
          check("  the account still has no email", (await c.query("select email from members where id = $1", [memberId])).rows[0].email === null);
        }
      } finally {
        await c.query("rollback");
      }
      const back = (await c.query("select auth_user_id, email from members where id = $1", [memberId])).rows[0];
      const kBack = await row(kiosk.nonce);
      check("rolled back: nothing attached, nothing used", back.auth_user_id === null && back.email === null && !kBack.used_at);
    }

    // ---------- permissions ----------
    const { rows: perm } = await c.query(`
      select has_function_privilege('anon', 'public.claim_member_account(text,uuid,uuid,text)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.claim_member_account(text,uuid,uuid,text)', 'execute') as authed,
             has_function_privilege('service_role', 'public.claim_member_account(text,uuid,uuid,text)', 'execute') as service,
             (select relrowsecurity from pg_class where oid = 'public.member_claims'::regclass) as rls`);
    check("only the server can run claim_member_account", !perm[0].anon && !perm[0].authed && perm[0].service);
    check("member_claims has row-level security on", perm[0].rls === true);

    // ---------- an account that can't be claimed ----------
    await c.query("update members set phone = null where id = $1", [memberId]);
    check("no new link for an account with no phone on file", (await claim.issueClaimLink(memberId, "receipt")) === null);
    check("a link already made still opens once the phone is gone", (await claim.readClaim(tokenOf(kioskUrl))).state === "ready");
    await c.query("update members set phone = '(555) 010-4242', erased_at = now() where id = $1", [memberId]);
    check("a removed account says 'gone'", (await claim.readClaim(tokenOf(kioskUrl))).state === "gone");
    check("gone: finishing on a removed account", (await finish(fakeUser(free ?? randomUUID()), tokenOf(kioskUrl))).reason === "gone");
  }
} finally {
  // Everything this made: the member (its links go with it).
  if (memberId) await db.from("members").delete().eq("id", memberId);
  const left = (
    await c.query(
      `select (select count(*)::int from members where id = $1) as members
              ${migrated ? ", (select count(*)::int from member_claims where member_id = $1 or nonce = any($2)) as claims" : ""}`,
      migrated ? [memberId, nonces] : [memberId],
    )
  ).rows[0];
  check("cleaned up: no test member or links left", left.members === 0 && (left.claims ?? 0) === 0, JSON.stringify(left));
  await c.end();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll claim database checks passed");
process.exit(failures ? 1 : 0);
