// Renders "Your Insiders+ year is already paid" (src/lib/email/
// paid-through-email.ts) to an HTML file to look at, with a sample member:
// "Jake", paid through March 13, 2027, renewing yearly at the adult rate.
// Offline: no database, nothing is sent. The pictures load from the
// email-assets bucket (run upload.mjs first).
//
//   node scripts/email-designs/preview-paid-through.mjs <out.html>
import { existsSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { ROOT } from "./source.mjs";

config({ path: join(ROOT, ".env.local"), quiet: true });
const SRC = join(ROOT, "src");
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const f = withExt(join(SRC, specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[a-z]+$/i.test(specifier)) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(SRC)) {
        const f = withExt(resolve(dirname(parent), specifier));
        if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

const out = resolve(process.argv[2] ?? join(ROOT, "scripts/email-designs/out/paid-through-preview.html"));
const { paidThroughHtml, paidThroughSubject, paidThroughText } = await import(pathToFileURL(join(SRC, "lib/email/paid-through-email.ts")).href);
const sample = {
  name: "Jake",
  paidThrough: "2027-03-13T18:00:00.000Z", // noon Central
  renewsAs: "year",
  rate: "adult",
  billingUrl: "https://www.royalecinemajoplin.com/account/billing",
};
writeFileSync(out, paidThroughHtml(sample));
console.log(`Subject: ${paidThroughSubject(sample)}\n\n${paidThroughText(sample)}\n\nWrote ${out}`);
