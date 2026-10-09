// Loads the old Indy register's history exports into the staging tables
// (supabase/migrations/20261009070000_indy_history_staging.sql), matches
// Indy users to members, links Indy card payments to Fortis sales, and
// prints a dry-run report. It grants no points and changes no member.
//
// Safe to re-run: each staging table is emptied and reloaded from the files
// in one transaction, so the result is the same every time.
//
// Prints counts and dollar totals only: never a name, email, phone or card
// digits. The exports stay where they are.
//
// Usage:
//   node scripts/load-indy-history.mjs [--dir <folder>] [--date 2026-10-09] [--users-date 2026-09-29] [--report-only]
// Default folder: ../imports/indy (next to this repo).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const DIR = opt("--dir", "../imports/indy");
const DATE = opt("--date", "2026-10-09");
const USERS_DATE = opt("--users-date", "2026-09-29");
const REPORT_ONLY = args.includes("--report-only");
// Indy times have no zone; Fortis times are UTC. The offset between them is
// found from the data (the hour shift that links the most card payments),
// with the window below for "the same moment".
const WINDOW_SECONDS = 5 * 60;

// ---------- CSV (quoted fields, commas and newlines inside quotes) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const read = (name) => parseCsv(readFileSync(join(DIR, name), "utf8"));

const lc = (s) => {
  const t = (s ?? "").trim().toLowerCase();
  return t || null;
};
const nz = (s) => ((s ?? "").trim() === "" ? null : s.trim());
// "$1,234.56", "-$1.00", "($1.00)", "12.5" -> cents
function cents(s) {
  let t = (s ?? "").trim();
  if (!t) return null;
  const neg = t.startsWith("-") || (t.startsWith("(") && t.endsWith(")"));
  t = t.replace(/[^0-9.]/g, "");
  if (!t) return null;
  const v = Math.round(Number(t) * 100);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
const num = (s) => {
  const v = Number((s ?? "").trim());
  return (s ?? "").trim() !== "" && Number.isFinite(v) ? v : null;
};
// "2023-03-08 22:03:31" kept as a zone-less timestamp
function ts(s) {
  const t = (s ?? "").trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/);
  if (m) return `${m[1]} ${m[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 00:00:00`;
  return null;
}
function phoneDigits(raw) {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}
const BRAND = { visa: "visa", mastercard: "mc", discover: "disc", amex: "amex" };

// ---------- db ----------
if (!process.env.SUPABASE_DB_HOST || !process.env.SUPABASE_DB_PASSWORD) {
  console.error("SUPABASE_DB_HOST and SUPABASE_DB_PASSWORD must be set in .env.local");
  process.exit(1);
}
const db = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await db.connect();

async function insert(table, cols, rows) {
  const defs = cols.map(([c, t]) => `${c} ${t}`).join(", ");
  const names = cols.map(([c]) => c).join(", ");
  for (let i = 0; i < rows.length; i += 2000) {
    await db.query(`insert into public.${table} (${names}) select ${names} from jsonb_to_recordset($1::jsonb) as x(${defs})`, [JSON.stringify(rows.slice(i, i + 2000))]);
  }
}

try {
  if (!REPORT_ONLY) {
    const users = read(`indy-users-${USERS_DATE}.csv`);
    const items = read(`indy-order-items-${DATE}.csv`);
    const pays = read(`indy-payments-${DATE}.csv`);
    const points = read(`indy-user-points-${DATE}.csv`);
    const shows = read(`indy-showings-${DATE}.csv`);
    const gifts = read(`indy-gift-cards-${DATE}.csv`);
    const vouchers = read(`indy-vouchers-${DATE}.csv`);

    await db.query("begin");
    await db.query(
      "truncate public.indy_fortis_links, public.indy_user_matches, public.indy_order_items, public.indy_payments, public.indy_user_points, public.indy_showings, public.indy_gift_cards, public.indy_vouchers, public.indy_users",
    );
    await insert(
      "indy_users",
      [["id", "text"], ["email_lc", "text"], ["phone_digits", "text"], ["points_preloaded", "numeric"], ["raw", "jsonb"]],
      users.map((r) => ({ id: r.id, email_lc: lc(r.email), phone_digits: phoneDigits(r.phone), points_preloaded: num(r.points_preloaded), raw: r })),
    );
    await insert(
      "indy_order_items",
      [
        ["row_no", "integer"], ["order_id", "text"], ["user_id", "text"], ["email_lc", "text"], ["state", "text"], ["type", "text"],
        ["order_state", "text"], ["price_cents", "integer"], ["tax_cents", "integer"], ["discount_cents", "integer"], ["voucher_cents", "integer"],
        ["paid_at_local", "timestamp"], ["movie_id", "text"], ["sales_channel", "text"], ["raw", "jsonb"],
      ],
      items.map((r, i) => ({
        row_no: i + 1, order_id: r.order_id, user_id: nz(r.user_id), email_lc: lc(r.user_email), state: nz(r.state), type: nz(r.type),
        order_state: nz(r.order_state), price_cents: cents(r.price), tax_cents: cents(r.tax_amount), discount_cents: cents(r.discount_amount),
        voucher_cents: cents(r.voucher_amount), paid_at_local: ts(r.paid_at), movie_id: nz(r.movie_id), sales_channel: nz(r.sales_channel), raw: r,
      })),
    );
    await insert(
      "indy_payments",
      [
        ["id", "text"], ["order_id", "text"], ["type", "text"], ["subtype", "text"], ["state", "text"], ["amount_cents", "integer"],
        ["paid_at_local", "timestamp"], ["last_four", "text"], ["card_type", "text"], ["raw", "jsonb"],
      ],
      pays.map((r) => ({
        id: r.id, order_id: nz(r.order_id), type: nz(r.type), subtype: nz(r.subtype), state: nz(r.state), amount_cents: cents(r.amount),
        paid_at_local: ts(r.paid_at), last_four: nz(r.last_four)?.padStart(4, "0") ?? null, card_type: BRAND[lc(r.card_type)] ?? lc(r.card_type), raw: r,
      })),
    );
    await insert(
      "indy_user_points",
      [
        ["id", "text"], ["email_lc", "text"], ["phone_digits", "text"], ["order_id", "text"], ["state", "text"], ["reason", "text"],
        ["amount_earned", "numeric"], ["amount_used", "numeric"], ["amount_remaining", "numeric"], ["expires_at_local", "timestamp"],
        ["created_at_local", "timestamp"], ["raw", "jsonb"],
      ],
      points.map((r) => ({
        id: r.id, email_lc: lc(r["user.email"]), phone_digits: phoneDigits(r["user.phone"]), order_id: nz(r.order_id), state: nz(r.state),
        reason: nz(r.reason), amount_earned: num(r.amount_earned), amount_used: num(r.amount_used), amount_remaining: num(r.amount_remaining),
        expires_at_local: ts(r.expires_at), created_at_local: ts(r.created_at), raw: r,
      })),
    );
    await insert(
      "indy_showings",
      [["id", "text"], ["time_local", "timestamp"], ["movie_id", "text"], ["raw", "jsonb"]],
      shows.map((r) => ({ id: r.id, time_local: ts(r.time), movie_id: nz(r.movie_id), raw: r })),
    );
    await insert(
      "indy_gift_cards",
      [["id", "text"], ["recipient_user_id", "text"], ["state", "text"], ["initial_cents", "integer"], ["balance_cents", "integer"], ["expires_at_local", "timestamp"], ["raw", "jsonb"]],
      gifts.map((r) => ({
        id: r.id, recipient_user_id: nz(r.recipient_user_id), state: nz(r.state), initial_cents: cents(r.initial_value), balance_cents: cents(r.balance),
        expires_at_local: ts(r.expires_at), raw: r,
      })),
    );
    await insert(
      "indy_vouchers",
      [["id", "text"], ["user_id", "text"], ["email_lc", "text"], ["state", "text"], ["voucher_type_name", "text"], ["raw", "jsonb"]],
      vouchers.map((r) => ({ id: r.id, user_id: nz(r["user.id"]), email_lc: lc(r["user.email"]), state: nz(r.state), voucher_type_name: nz(r["voucher_type.name"]), raw: r })),
    );

    // ---------- Indy users -> members: indy id, else exact email, else phone (unique only) ----------
    // Users seen anywhere: the users file, plus order items' user ids.
    await db.query(`
      with m as (select id, indy_user_id, lower(trim(email)) email_lc, phone_digits from public.members where erased_at is null),
      by_email as (select email_lc, min(id::text)::uuid id from m where email_lc is not null group by 1 having count(*) = 1),
      by_phone as (select phone_digits, min(id::text)::uuid id from m where phone_digits is not null group by 1 having count(*) = 1),
      u as (
        select u.id, u.email_lc, u.phone_digits from public.indy_users u
        union all
        (select distinct on (user_id) user_id, email_lc, null from public.indy_order_items
        where user_id is not null and user_id not in (select id from public.indy_users) order by user_id, email_lc nulls last)
      )
      insert into public.indy_user_matches (indy_user_id, member_id, match_kind)
      select u.id, coalesce(mi.id, e.id, p.id), case when mi.id is not null then 'indy_id' when e.id is not null then 'email' else 'phone' end
      from u
      left join m mi on mi.indy_user_id::text = u.id
      left join by_email e on e.email_lc = u.email_lc
      left join by_phone p on p.phone_digits = u.phone_digits
      where coalesce(mi.id, e.id, p.id) is not null
      on conflict (indy_user_id) do nothing`);

    // ---------- Indy card payments -> Fortis sales ----------
    // Find the hour offset (Indy local -> UTC) that links the most payments,
    // then link one-to-one, closest in time first.
    const { rows: offs } = await db.query(`
      select h, count(distinct p.id) n
      from generate_series(-8, 8) h
      join public.indy_payments p on p.type = 'card' and p.state = 'completed' and p.last_four is not null
      join public.fortis_sales s on s.kind = 'sale' and s.last_four = p.last_four and s.amount_cents = p.amount_cents
        and abs(extract(epoch from (s.created_at - ((p.paid_at_local + make_interval(hours => h)) at time zone 'UTC')))) <= ${WINDOW_SECONDS}
      join public.fortis_cards c on c.card_key = s.card_key and c.brand = p.card_type
      group by h order by n desc`);
    const best = offs[0]?.h ?? 0;
    // Allow the best offset and one hour either side of it (daylight saving).
    await db.query(`
      with cand as (
        select p.id pid, s.id sid,
          min(abs(extract(epoch from (s.created_at - ((p.paid_at_local + make_interval(hours => h)) at time zone 'UTC'))))) secs
        from public.indy_payments p
        cross join (values ($1::int), ($1::int - 1), ($1::int + 1)) o(h)
        join public.fortis_sales s on s.kind = 'sale' and s.last_four = p.last_four and s.amount_cents = p.amount_cents
          and abs(extract(epoch from (s.created_at - ((p.paid_at_local + make_interval(hours => h)) at time zone 'UTC')))) <= ${WINDOW_SECONDS}
        join public.fortis_cards c on c.card_key = s.card_key and c.brand = p.card_type
        where p.type = 'card' and p.state = 'completed'
        group by 1, 2
      )
      select pid, sid, secs from cand order by secs, pid, sid`, [best]).then(async ({ rows }) => {
      const usedP = new Set();
      const usedS = new Set();
      const links = [];
      for (const r of rows) {
        if (usedP.has(r.pid) || usedS.has(r.sid)) continue;
        usedP.add(r.pid);
        usedS.add(r.sid);
        links.push({ payment_id: r.pid, fortis_sale_id: r.sid, seconds_apart: Math.round(Number(r.secs)) });
      }
      await insert("indy_fortis_links", [["payment_id", "text"], ["fortis_sale_id", "uuid"], ["seconds_apart", "integer"]], links);
    });
    await db.query("commit");
    console.log(`Loaded. Offset Indy local -> UTC: +${best}h (+/-1h for daylight saving), window ${WINDOW_SECONDS / 60} min.`);
    console.log("Offset scan (hours: payments linked):", offs.slice(0, 4).map((o) => `${o.h}:${o.n}`).join(", "));
  }

  // ---------- report (counts and dollars only) ----------
  const q = async (label, sql) => {
    const { rows } = await db.query(sql);
    console.log(`\n# ${label}`);
    console.table(rows);
  };
  await q("Loaded rows", `select (select count(*) from indy_users) users, (select count(*) from indy_order_items) items, (select count(distinct order_id) from indy_order_items) orders,
    (select count(*) from indy_payments) payments, (select count(*) from indy_user_points) points_rows, (select count(*) from indy_showings) showings,
    (select count(*) from indy_gift_cards) gift_cards, (select count(*) from indy_vouchers) vouchers`);
  await q("User matches", `select match_kind, count(*) from indy_user_matches group by 1`);
  // Order money = completed payments on the order (what the guest paid, tax and tip in).
  await q("Order coverage (orders with a completed payment)", `
    with o as (select order_id, sum(amount_cents) c from indy_payments where state = 'completed' group by 1),
    ou as (select distinct on (order_id) order_id, user_id from indy_order_items where user_id is not null order by order_id, row_no)
    select case when m.member_id is not null then 'matched member' when ou.user_id is not null then 'Indy user, no member' else 'no Indy user' end who,
      count(*) orders, round(sum(o.c) / 100.0, 2) usd
    from o left join ou using (order_id) left join indy_user_matches m on m.indy_user_id = ou.user_id group by 1 order by 1`);
  await q("Indy card payments linked to Fortis", `
    select count(*) filter (where p.type = 'card' and p.state = 'completed') card_payments,
      count(*) filter (where p.type = 'card' and p.state = 'completed' and p.paid_at_local >= '2025-03-12') card_payments_in_fortis_range,
      count(l.payment_id) linked, round(sum(p.amount_cents) filter (where l.payment_id is not null) / 100.0, 2) linked_usd,
      (select count(*) from fortis_sales where kind = 'sale') fortis_sales,
      percentile_cont(0.5) within group (order by l.seconds_apart) median_secs
    from indy_payments p left join indy_fortis_links l on l.payment_id = p.id`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Stopped: ${e.message}. Nothing was changed.`);
  process.exitCode = 1;
} finally {
  await db.end();
}
