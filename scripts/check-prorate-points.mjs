// Checks the prorated $5 off without a database: it takes only the points
// for what it took off (20 a dollar, never more than 100, never less than
// 1), in lib/loyalty.ts and lib/register-totals.ts, and the points history
// says "$3.00 off (60 pts)". Also reads migration 20261009010000.
//
// Usage: node scripts/check-prorate-points.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { readFileSync } from "node:fs";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { registerTotals } = await import("../src/lib/register-totals.ts");
const { rewardPointsFor, rewardLabel } = await import("../src/lib/loyalty.ts");
const { rewardOff } = await import("../src/lib/points-history.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

check("$3.00 takes 60 points", rewardPointsFor(3) === 60);
check("$5.00 takes 100", rewardPointsFor(5) === 100);
check("never more than 100", rewardPointsFor(7) === 100);
check("a cent takes 1, never 0", rewardPointsFor(0.01) === 1);
check("$2.47 takes 49 (rounded)", rewardPointsFor(2.47) === 49);
check("nothing off takes nothing", rewardPointsFor(0) === 0 && rewardPointsFor(-1) === 0);
check("the label", rewardLabel(3) === "Points reward (60 pts)");

const insider = (points) => ({ tier: "Insiders", points });
{
  const t = registerTotals([{ unit: 3, qty: 1 }], insider(150), false, true, true);
  check("a $3 order: $3.00 off, 60 points", t.redemptionDiscount === 3 && t.redemptionPoints === 60 && t.total === 0, JSON.stringify(t));
}
{
  const t = registerTotals([{ unit: 12, qty: 1 }], insider(150), false, true, true);
  check("a $12 order: $5.00 off, 100 points", t.redemptionDiscount === 5 && t.redemptionPoints === 100, JSON.stringify(t));
}
{
  const t = registerTotals([{ unit: 3, qty: 1 }], insider(60), false, true, true);
  check("60 points cover a $3 order", t.canRedeem && t.redemptionPoints === 60, JSON.stringify(t));
}
{
  const t = registerTotals([{ unit: 3, qty: 1 }], insider(59), false, true, true);
  check("59 points don't", !t.canRedeem && t.redemptionDiscount === 0 && t.redemptionPoints === 0, JSON.stringify(t));
}
{
  const t = registerTotals([], insider(99), false, true, false);
  check("an empty order still needs the full 100 to offer it", !t.canRedeem);
}
{
  const t = registerTotals([{ unit: 3, qty: 1 }], insider(150), false, true, false);
  check("not ticked: nothing taken, but the panel knows it's $3.00", t.redemptionPoints === 0 && t.rewardAvailable === 3, JSON.stringify(t));
}

check("history: a new row", rewardOff("$3.00 off order #1234", -60) === "$3.00 off (60 pts)", rewardOff("$3.00 off order #1234", -60));
check("history: an old $5 row", rewardOff("$5 off order #900", -100) === "$5.00 off (100 pts)");
check("history: no note", rewardOff(null, -100) === "$5.00 off (100 pts)");

const sql = readFileSync(new URL("../supabase/migrations/20261009010000_prorate_reward_points.sql", import.meta.url), "utf8");
check("migration: never more than 100", /least\(100, greatest\(0, coalesce\(p_discount_points, 0\)\)\)/.test(sql));
check("migration: the note has what came off", /to_char\(v_off, 'FM999990\.00'\) \|\| ' off'/.test(sql));
check("migration: takes v_dpts, not p_discount_points", !/-p_discount_points/.test(sql) && /-v_dpts/.test(sql));

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
