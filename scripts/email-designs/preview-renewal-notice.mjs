// Renders the yearly renewal notice (src/lib/email/renewal-notice-email.ts)
// to an HTML file to look at, with a sample member: "Jake", renewing March
// 13, 2027, $153 + $13.35 tax = $166.35 on a Visa ending 4242. Offline: no
// database, no Stripe, nothing is sent. The pictures load from the
// email-assets bucket.
//
//   node scripts/email-designs/preview-renewal-notice.mjs <out.html>
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

const out = resolve(process.argv[2] ?? join(ROOT, "scripts/email-designs/out/renewal-notice-preview.html"));
const { renewalNoticeHtml, renewalNoticeSubject, renewalNoticeText } = await import(pathToFileURL(join(SRC, "lib/email/renewal-notice-email.ts")).href);
const sample = {
  name: "Jake",
  chargeAt: "2027-03-13T18:00:00.000Z", // noon Central
  priceCents: 15300,
  taxCents: 1335,
  totalCents: 16635,
  card: "Visa ending 4242",
  billingUrl: "https://www.royalecinemajoplin.com/account/login?next=%2Faccount%2Fbilling",
};
writeFileSync(out, renewalNoticeHtml(sample));
console.log(`Subject: ${renewalNoticeSubject(sample)}\n\n${renewalNoticeText(sample)}\n\nWrote ${out}`);
