// Keeps Back office → Roadmap (roadmap_items) current from the command
// line. Staff only, like the page. Uses the service role from .env.local,
// so run it from the main checkout.
//
//   node scripts/roadmap.mjs list [--all]
//       The board: building, final checks, in line (with places), ideas,
//       and the last 10 shipped (--all: every shipped item, and not doing).
//   node scripts/roadmap.mjs set <slug> <status>
//       idea | queued | building | reviewing | live | not_doing. Going live
//       stamps today's date and this checkout's package.json version.
//   node scripts/roadmap.mjs add "<title>" "<summary>" [--status queued]
//       [--requested-by-name "Jake B."] [--notes "internal notes"] [--slug my-slug]
//   node scripts/roadmap.mjs rank <slug> <n>
//       Moves it to place n within its status (the queue order for queued).
//
// Prints compactly: titles, slugs, statuses, counts. Never names who asked
// or any member details.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const STATUSES = ["idea", "queued", "building", "reviewing", "live", "not_doing"];
const LABEL = { idea: "Idea", queued: "In line", building: "Building", reviewing: "Final checks", live: "Live", not_doing: "Not doing" };

// Stops the command with a message. Thrown rather than process.exit(): on
// Windows, exiting while a connection is still closing can crash Node.
class Stop extends Error {}
function die(msg) {
  throw new Stop(msg);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local (run from the main checkout).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function packageVersion() {
  try {
    return String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  } catch {
    return null;
  }
}

// The same rule as src/lib/roadmap.ts (roadmapSlug).
function slugFor(title) {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "item";
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (name === "all") flags[name] = true;
      else if (next === undefined || next.startsWith("--")) die(`--${name} needs a value.`);
      else {
        flags[name] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

async function getItem(slug) {
  const { data, error } = await db.from("roadmap_items").select("id, slug, title, status, rank, shipped_in_version").eq("slug", slug).maybeSingle();
  if (error) die(`Couldn't read the list: ${error.message}`);
  if (!data) die(`No item with the slug "${slug}". Try: node scripts/roadmap.mjs list --all`);
  return data;
}

function day(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "";
}

async function list(all) {
  const { data: items, error } = await db
    .from("roadmap_items")
    .select("id, slug, title, status, rank, requested_by_member_id, requested_by_name, shipped_at, shipped_in_version, created_at")
    .order("rank");
  if (error) die(`Couldn't read the list: ${error.message}`);
  const byRank = (a, b) => a.rank - b.rank || a.created_at.localeCompare(b.created_at);
  let place = 0;
  const line = (i) => {
    const pos = i.status === "queued" ? `#${++place}`.padEnd(4) : "    ";
    const bits = [
      pos,
      i.slug.padEnd(34),
      i.title,
      i.requested_by_member_id || i.requested_by_name ? "(requested)" : "",
      i.status === "live" ? `· ${day(i.shipped_at)}${i.shipped_in_version ? ` v${i.shipped_in_version.split(".").slice(0, 2).join(".")}` : ""}` : "",
    ];
    return `  ${bits.filter(Boolean).join(" ")}`;
  };
  const show = (status, rows) => {
    if (!rows.length) return;
    console.log(`\n${LABEL[status]} (${rows.length})`);
    for (const r of rows) console.log(line(r));
  };
  for (const s of ["building", "reviewing", "queued", "idea"]) show(s, items.filter((i) => i.status === s).sort(byRank));
  const live = items.filter((i) => i.status === "live").sort((a, b) => (b.shipped_at ?? "").localeCompare(a.shipped_at ?? "") || byRank(a, b));
  show("live", all ? live : live.slice(0, 10));
  if (all) show("not_doing", items.filter((i) => i.status === "not_doing").sort(byRank));
  const total = (s) => items.filter((i) => i.status === s).length;
  console.log(`\n${items.length} items: ${STATUSES.map((s) => `${total(s)} ${LABEL[s].toLowerCase()}`).join(", ")}. Version ${packageVersion() ?? "?"}.`);
}

async function setStatus(slug, status) {
  if (!STATUSES.includes(status)) die(`Status must be one of: ${STATUSES.join(", ")}`);
  const item = await getItem(slug);
  if (item.status === status) return console.log(`${slug} is already ${status}.`);
  const patch = { status };
  if (status === "live") {
    const v = packageVersion();
    if (v) patch.shipped_in_version = v;
  }
  const { error } = await db.from("roadmap_items").update(patch).eq("id", item.id);
  if (error) die(`Didn't save: ${error.message}`);
  console.log(`${slug}: ${item.status} -> ${status}${patch.shipped_in_version ? ` (shipped in ${patch.shipped_in_version})` : ""}`);
}

async function add(title, summary, flags) {
  if (!title?.trim()) die('Usage: add "<title>" "<summary>" [--status queued] [--requested-by-name "Jake B."] [--notes "..."]');
  const status = flags.status ?? "idea";
  if (!STATUSES.includes(status)) die(`Status must be one of: ${STATUSES.join(", ")}`);
  let slug = flags.slug ?? slugFor(title);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die("The slug can only have a-z, 0-9 and dashes.");
  const { data: taken } = await db.from("roadmap_items").select("slug").like("slug", `${slug}%`);
  const used = new Set((taken ?? []).map((r) => r.slug));
  if (used.has(slug)) {
    if (flags.slug) die(`The slug "${slug}" is taken.`);
    let n = 2;
    while (used.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  const row = {
    slug,
    title: title.trim().slice(0, 120),
    public_summary: (summary ?? "").trim().slice(0, 1000),
    internal_notes: flags.notes ? String(flags.notes).slice(0, 4000) : null,
    status,
    requested_by_name: flags["requested-by-name"] ? String(flags["requested-by-name"]).trim().slice(0, 60) : null,
    shipped_in_version: status === "live" ? packageVersion() : null,
  };
  const { error } = await db.from("roadmap_items").insert(row);
  if (error) die(`Didn't save: ${error.message}`);
  console.log(`Added ${slug} (${status}).`);
}

async function rank(slug, nRaw) {
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 1) die("Usage: rank <slug> <n>  (n is 1 or more)");
  const item = await getItem(slug);
  const { data, error } = await db.from("roadmap_items").select("id, slug, rank, created_at").eq("status", item.status).order("rank").order("created_at");
  if (error) die(`Couldn't read the list: ${error.message}`);
  const order = data.filter((r) => r.id !== item.id);
  order.splice(Math.min(n, order.length + 1) - 1, 0, data.find((r) => r.id === item.id));
  const changes = order.map((r, i) => ({ id: r.id, rank: i + 1, was: r.rank })).filter((c) => c.rank !== c.was);
  for (const c of changes) {
    const { error: e } = await db.from("roadmap_items").update({ rank: c.rank }).eq("id", c.id);
    if (e) die(`Stopped partway: ${e.message}`);
  }
  console.log(`${slug} is now #${order.findIndex((r) => r.id === item.id) + 1} of ${order.length} (${LABEL[item.status]}; ${changes.length} rank${changes.length === 1 ? "" : "s"} changed).`);
}

try {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...args] = pos;
  if (cmd === "list") await list(!!flags.all);
  else if (cmd === "set") await setStatus(args[0], args[1]);
  else if (cmd === "add") await add(args[0], args[1], flags);
  else if (cmd === "rank") await rank(args[0], args[1]);
  else {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 17).map((l) => l.slice(3)).join("\n"));
    if (cmd && cmd !== "help") process.exitCode = 1;
  }
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
