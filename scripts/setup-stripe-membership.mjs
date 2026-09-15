// One-off setup: creates the "Royale Insiders+" Stripe Product and its three
// recurring monthly Prices (adult/senior/student), matching the real
// business's advertised membership pricing. Safe to re-run -- it looks for
// an existing product by name before creating a new one, but each run that
// doesn't find an existing price will create new duplicate Price objects, so
// only run this once per Stripe account (test vs live keys are separate
// accounts, so it needs to be re-run once when switching to live keys).
//
// Usage: node scripts/setup-stripe-membership.mjs
import Stripe from "stripe";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local");
  process.exit(1);
}
const stripe = new Stripe(key);

const PRODUCT_NAME = "Royale Insiders+";
const TIERS = [
  { key: "adult", nickname: "Insiders+ Adult", unitAmount: 1500 },
  { key: "senior", nickname: "Insiders+ Senior", unitAmount: 1200 },
  { key: "student", nickname: "Insiders+ Student", unitAmount: 1000 },
];

let product = (await stripe.products.search({ query: `name:"${PRODUCT_NAME}"` })).data[0];
if (!product) {
  product = await stripe.products.create({ name: PRODUCT_NAME, description: "Unlimited entry, concession discounts, priority access, and points." });
  console.log(`Created product ${product.id}`);
} else {
  console.log(`Using existing product ${product.id}`);
}

const envLines = [];
for (const tier of TIERS) {
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  let price = existing.data.find((p) => p.nickname === tier.nickname);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: tier.unitAmount,
      recurring: { interval: "month" },
      nickname: tier.nickname,
    });
    console.log(`Created price ${price.id} (${tier.nickname}, $${(tier.unitAmount / 100).toFixed(2)}/mo)`);
  } else {
    console.log(`Using existing price ${price.id} (${tier.nickname})`);
  }
  envLines.push(`STRIPE_PRICE_INSIDERS_PLUS_${tier.key.toUpperCase()}=${price.id}`);
}

console.log("\nAdd these to .env.local and Vercel:\n");
console.log(envLines.join("\n"));
