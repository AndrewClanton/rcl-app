// Checks "claim your account" links (src/lib/member-claim-token.ts and
// claim-link.ts) without touching the database: a token opens to what was
// sealed, runs out on time for each kind, and refuses any edit -- a flipped
// bit, a different kind, member or expiry, another key -- and that the
// phone-digits step is gone for good. Also that the receipt prints a claim
// QR only for a real claim link.
//
// Usage: node scripts/check-member-claim.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY must be set in .env.local (it's the signing key).");
  process.exit(1);
}
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
const tok = await import("../src/lib/member-claim-token.ts");
const { claimUrl, isClaimUrl, isClaimPath, CLAIM_PATH } = await import("../src/lib/claim-link.ts");
const { receiptXml } = await import("../src/lib/print/receipt.ts");
const { SITE_URL } = await import("../src/lib/site.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const MEMBER = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const NOW = Date.UTC(2026, 8, 30, 18, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;

// ---------- seal and open ----------
const kiosk = tok.sealClaimToken(MEMBER, "kiosk", NOW);
const receipt = tok.sealClaimToken(MEMBER, "receipt", NOW);
check("seals a kiosk and a receipt token", !!kiosk && !!receipt);
check("token is 58 characters of base64url", /^[A-Za-z0-9_-]{58}$/.test(kiosk.token), kiosk.token);
check("each token gets its own nonce", kiosk.nonce !== receipt.nonce && kiosk.token !== receipt.token);

const k = tok.openClaimToken(kiosk.token, NOW);
check("opens to the same member", k?.memberId === MEMBER, k?.memberId);
check("opens to the same kind", k?.kind === "kiosk" && tok.openClaimToken(receipt.token, NOW)?.kind === "receipt");
check("opens to the same nonce", k?.nonce === kiosk.nonce);
check("fresh token isn't expired", k?.expired === false);

// ---------- lifetimes ----------
check("kiosk link lasts 30 minutes", kiosk.exp - NOW === 30 * MIN, `${(kiosk.exp - NOW) / MIN} min`);
check("receipt link lasts two weeks", receipt.exp - NOW === 14 * DAY, `${(receipt.exp - NOW) / DAY} days`);
check("kiosk link still good at 29 minutes", tok.openClaimToken(kiosk.token, NOW + 29 * MIN)?.expired === false);
check("kiosk link expired at 30 minutes", tok.openClaimToken(kiosk.token, NOW + 30 * MIN)?.expired === true);
check("receipt link still good at 13 days", tok.openClaimToken(receipt.token, NOW + 13 * DAY)?.expired === false);
check("receipt link expired at 14 days", tok.openClaimToken(receipt.token, NOW + 14 * DAY + 1)?.expired === true);
check("an expired token still says whose it is (for the 'run out' page)", tok.openClaimToken(kiosk.token, NOW + DAY)?.memberId === MEMBER);

// ---------- tampering ----------
const raw = Buffer.from(kiosk.token, "base64url");
const edited = (at, fn) => {
  const b = Buffer.from(raw);
  b[at] = fn(b[at]);
  return b.toString("base64url");
};
check("refuses a flipped bit in the member id", tok.openClaimToken(edited(5, (x) => x ^ 1), NOW) === null);
check("refuses a flipped bit in the expiry", tok.openClaimToken(edited(20, (x) => x ^ 1), NOW) === null);
check("refuses a pushed-out expiry", tok.openClaimToken(edited(18, (x) => x + 1), NOW) === null);
check("refuses a flipped bit in the nonce", tok.openClaimToken(edited(25, (x) => x ^ 1), NOW) === null);
check("refuses a flipped bit in the signature", tok.openClaimToken(edited(40, (x) => x ^ 1), NOW) === null);
check("refuses a kiosk token relabelled as a receipt one (30 min -> 2 weeks)", tok.openClaimToken(edited(1, () => 1), NOW) === null);
check("refuses an unknown kind", tok.openClaimToken(edited(1, () => 7), NOW) === null);
check("refuses an unknown version", tok.openClaimToken(edited(0, () => 2), NOW) === null);
check("refuses a truncated token", tok.openClaimToken(kiosk.token.slice(0, 57), NOW) === null);
check("refuses a padded token", tok.openClaimToken(kiosk.token + "A", NOW) === null);
check("refuses junk, empty and non-strings", [null, undefined, "", "not a token", 42, {}].every((t) => tok.openClaimToken(t, NOW) === null));
// Another member's body with this token's signature.
const other = tok.sealClaimToken("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "kiosk", NOW);
const spliced = Buffer.concat([Buffer.from(other.token, "base64url").subarray(0, 31), raw.subarray(31)]).toString("base64url");
check("refuses one member's details with another's signature", tok.openClaimToken(spliced, NOW) === null);

// A token signed with a different key (another project, or a guessed one).
const realKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "some-other-key";
const forged = tok.sealClaimToken(MEMBER, "receipt", NOW);
process.env.SUPABASE_SERVICE_ROLE_KEY = realKey;
check("refuses a token signed with another key", tok.openClaimToken(forged.token, NOW) === null);
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
check("makes no token at all with no signing key", tok.sealClaimToken(MEMBER, "kiosk", NOW) === null);
check("opens no token at all with no signing key", tok.openClaimToken(kiosk.token, NOW) === null);
process.env.SUPABASE_SERVICE_ROLE_KEY = realKey;

check("won't seal for a non-UUID member", tok.sealClaimToken("not-a-uuid", "kiosk", NOW) === null);
check("won't seal an unknown kind", tok.sealClaimToken(MEMBER, "bogus", NOW) === null);

// ---------- no phone-digits step ----------
check(
  "the digits proof and the wrong-tries lockout are gone",
  !("sealDigitsProof" in tok) && !("digitsProofOk" in tok) && !("DIGITS_PROOF_COOKIE" in tok) && !("MAX_WRONG_DIGITS" in tok),
);

// ---------- links on this site only ----------
const url = claimUrl(kiosk.token);
check("claim URL is on this site", url === `${SITE_URL}${CLAIM_PATH}?t=${kiosk.token}`, url);
check("claim URL passes isClaimUrl", isClaimUrl(url));
check("isClaimUrl refuses another site", !isClaimUrl(`https://evil.example${CLAIM_PATH}?t=${kiosk.token}`));
check("isClaimUrl refuses another page", !isClaimUrl(`${SITE_URL}/account/login?t=${kiosk.token}`));
check("isClaimUrl refuses extra junk", !isClaimUrl(`${url}&next=https://evil.example`) && !isClaimUrl(`${url}"><script>`));
check("isClaimUrl refuses non-strings", !isClaimUrl(null) && !isClaimUrl(undefined) && !isClaimUrl(42));
check("isClaimPath: the claim page, with or without its query", isClaimPath(CLAIM_PATH) && isClaimPath(`${CLAIM_PATH}?t=abc`));
check("isClaimPath: not other account pages", !isClaimPath("/account") && !isClaimPath("/account/claimed") && !isClaimPath("/account/login?next=/account/claim"));

// ---------- the receipt ----------
const sale = {
  orderNumber: 1234,
  at: new Date(NOW).toISOString(),
  cashier: "Sam",
  member: "Pat Example",
  orderName: null,
  lines: [{ name: "Popcorn", qty: 1, unit: 6, mods: [] }],
  subtotal: 6,
  discounts: [],
  tax: 0.5,
  tip: 0,
  total: 6.5,
  payments: [{ label: "Card", amount: 6.5 }],
};
const withQr = receiptXml(sale, { claimUrl: receipt && claimUrl(receipt.token) });
check("receipt prints the claim QR with the printer's QR command", withQr.includes(`<symbol type="qrcode_model_2" level="level_m" width="5" align="center">${claimUrl(receipt.token)}</symbol>`));
check("receipt says what the QR is for", withQr.includes("Scan to see your points online"));
check("receipt without a link has no QR", !receiptXml(sale).includes("<symbol") && !receiptXml(sale, { claimUrl: null }).includes("<symbol"));
check("receipt refuses a QR for anything that isn't a claim link", !receiptXml(sale, { claimUrl: "https://evil.example/x" }).includes("<symbol"));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll claim-token checks passed");
process.exit(failures ? 1 : 0);
