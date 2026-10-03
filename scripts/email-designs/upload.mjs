// Puts the ready-made emails' pictures (scripts/email-designs/out/designs,
// made by render.mjs) in the public email-assets bucket on our Supabase,
// where the emails load them from. Run once after the migration
// 20261002020000_email_ready_to_send.sql (which makes the bucket), and
// again after render.mjs makes new pictures.
//
//   node scripts/email-designs/upload.mjs          (uploads what's missing)
//   node scripts/email-designs/upload.mjs --dry    (just lists it)
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// .env.local. File names carry a hash of their content, so nothing is ever
// overwritten: an email that already went out keeps its pictures.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { HERE, ROOT } from "./source.mjs";

config({ path: join(ROOT, ".env.local") });
const dry = process.argv.includes("--dry");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || (!key && !dry)) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local).");
  process.exit(1);
}
const BUCKET = "email-assets";
const OUT = join(HERE, "out");
const files = readdirSync(join(OUT, "designs"), { recursive: true })
  .map(String)
  .filter((f) => /\.(png|jpg)$/.test(f))
  .map((f) => relative(OUT, join(OUT, "designs", f)).replace(/\\/g, "/"));

const publicUrl = (path) => `${url.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
const supabase = key ? createClient(url, key, { auth: { persistSession: false } }) : null;
let uploaded = 0;
let there = 0;
for (const path of files) {
  const head = await fetch(publicUrl(path), { method: "HEAD" }).catch(() => null);
  if (head?.ok) {
    there++;
    continue;
  }
  if (dry) {
    console.log(`would upload ${path}`);
    continue;
  }
  const body = readFileSync(join(OUT, path));
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: path.endsWith(".jpg") ? "image/jpeg" : "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error && !/exists/i.test(error.message)) {
    console.error(`${path}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  uploaded++;
}
console.log(`${files.length} pictures: ${there} already there, ${dry ? "dry run" : `${uploaded} uploaded`}.`);
