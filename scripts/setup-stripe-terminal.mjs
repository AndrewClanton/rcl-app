// One-off setup: creates the Stripe Terminal Location for the venue and (in
// test mode) a simulated reader so the POS integration can be built and
// tested before the real hardware is registered.
//
// Usage: node scripts/setup-stripe-terminal.mjs
//
// When the real reader (e.g. a physical Stripe Reader S700) is powered on
// and connected to the venue's WiFi, it shows a registration code on its
// screen. Register it to the same Location either via the Stripe Dashboard
// (Terminal -> Readers -> Register reader) or by re-running a variant of
// this script with that code, then swap STRIPE_TERMINAL_READER_ID in
// .env.local / Vercel to the real reader's id.
import Stripe from "stripe";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local");
  process.exit(1);
}
const stripe = new Stripe(key);

const LOCATION_NAME = "Royale Cinema Lounge";

let location = (await stripe.terminal.locations.list({ limit: 100 })).data.find((l) => l.display_name === LOCATION_NAME);
if (!location) {
  location = await stripe.terminal.locations.create({
    display_name: LOCATION_NAME,
    address: {
      line1: "715 E Broadway",
      city: "Joplin",
      state: "MO",
      postal_code: "64801",
      country: "US",
    },
  });
  console.log(`Created location ${location.id}`);
} else {
  console.log(`Using existing location ${location.id}`);
}

// Simulated reader for local/dev testing only -- only creatable in test mode.
let reader = (await stripe.terminal.readers.list({ location: location.id, limit: 100 })).data.find((r) => r.label === "Dev simulated S700");
if (!reader) {
  reader = await stripe.terminal.readers.create({
    registration_code: "simulated-s700",
    location: location.id,
    label: "Dev simulated S700",
  });
  console.log(`Created simulated reader ${reader.id}`);
} else {
  console.log(`Using existing simulated reader ${reader.id}`);
}

console.log("\nAdd these to .env.local:\n");
console.log(`STRIPE_TERMINAL_LOCATION_ID=${location.id}`);
console.log(`STRIPE_TERMINAL_READER_ID=${reader.id}`);
console.log("\n(STRIPE_TERMINAL_READER_ID above is the SIMULATED reader -- for dev/testing only. Swap it for the real reader's id once you register your physical S700, and only add these to Vercel once you have a real reader id.)");
