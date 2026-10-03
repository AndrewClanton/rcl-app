// In-memory stand-ins used by scripts/check-email-marketing.mjs: the
// Supabase service-role client (with the email migration's functions
// written in JS), Resend's REST API as a fetch (batch sends with
// idempotency keys, cancel), next/server, next/cache, the staff session
// and the lineup loader. Adapted from the mailing-list branch's fakes. No
// database, no network, nothing is sent.
import { createHash, randomUUID } from "node:crypto";

// ---------------- Supabase (service-role client) ----------------
export const db = {
  members: [],
  member_email_prefs: [],
  email_consent_log: [],
  email_suppressions: [],
  email_campaigns: [],
  email_sends: [],
  email_events: [],
  email_settings: [],
  member_claims: [],
  member_visits: [],
  bookings: [],
  orders: [],
  movies: [],
  menu_items: [],
  house_events: [],
  // The signed-in test admin (staff, below), picked to send email
  // (lib/email/senders.ts).
  employees: [{ id: "e0000000-0000-4000-8000-000000000001", name: "Test Admin", role: "admin", active: true, sends_email: true }],
  legacy_billing_payers: [],
};

// Requests that fail once, on purpose: {table, op} ("select", "insert",
// "update", "delete", "upsert").
export const faults = [];

// Unique keys per table (nulls never clash), like the migration's.
const UNIQUE = {
  email_events: [["svix_id"]],
  email_suppressions: [["email_hash"]],
  member_email_prefs: [["member_id"]],
  email_settings: [["key"]],
  member_claims: [["nonce"]],
  email_campaigns: [["send_key"]],
  members: [["indy_user_id"]],
};
const PRIMARY = { member_email_prefs: "member_id", email_suppressions: "email_hash", email_settings: "key" };

const nowIso = () => new Date().toISOString();
const get = (r, c) => (c.includes("->>") ? (r[c.split("->>")[0]] ?? {})[c.split("->>")[1]] : r[c]);
const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1);
const unq = (v) => (typeof v === "string" && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

function clash(table, row, rows) {
  for (const cols of UNIQUE[table] ?? []) {
    if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
    const hit = rows.find((x) => x !== row && cols.every((c) => x[c] === row[c]));
    if (hit) return hit;
  }
  return null;
}

class Query {
  constructor(table) {
    Object.assign(this, { table, filters: [], op: "select", payload: null, returning: false, opts: {}, one: null, from: null, to: null, lim: null, sorts: [], upsertOpts: null });
  }
  select(_cols, opts = {}) {
    if (this.op === "select") this.opts = opts;
    else this.returning = true;
  }
  insert(obj) {
    this.op = "insert";
    this.payload = obj;
  }
  upsert(obj, opts = {}) {
    this.op = "upsert";
    this.payload = obj;
    this.upsertOpts = opts;
  }
  update(obj) {
    this.op = "update";
    this.payload = obj;
  }
  delete() {
    this.op = "delete";
  }
  eq(c, v) {
    this.filters.push((r) => get(r, c) === v);
  }
  neq(c, v) {
    this.filters.push((r) => get(r, c) !== v);
  }
  lt(c, v) {
    this.filters.push((r) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) < v);
  }
  lte(c, v) {
    this.filters.push((r) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) <= v);
  }
  gt(c, v) {
    this.filters.push((r) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) > v);
  }
  gte(c, v) {
    this.filters.push((r) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) >= v);
  }
  in(c, list) {
    this.filters.push((r) => list.includes(get(r, c)));
  }
  is(c, v) {
    this.filters.push((r) => (get(r, c) ?? null) === v);
  }
  not(c, op, v) {
    if (op !== "is") throw new Error("fake: not() only supports is");
    this.filters.push((r) => (get(r, c) ?? null) !== v);
  }
  like(c, p) {
    const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.filters.push((r) => re.test(String(get(r, c) ?? "")));
  }
  ilike(c, p) {
    const want = p.replace(/\\([\\%_])/g, "$1").toLowerCase();
    this.filters.push((r) => String(get(r, c) ?? "").toLowerCase() === want);
  }
  or(expr) {
    const parts = expr.split(",").map((p) => {
      const [c, op, ...rest] = p.split(".");
      return [c, op, unq(rest.join("."))];
    });
    this.filters.push((r) =>
      parts.some(([c, op, v]) => {
        const x = get(r, c);
        if (op === "is") return v === "null" ? (x ?? null) === null : String(x) === v;
        if (op === "eq") return String(x) === v;
        if (op === "lte") return x !== null && x !== undefined && x <= v;
        if (op === "lt") return x !== null && x !== undefined && x < v;
        if (op === "gte") return x !== null && x !== undefined && x >= v;
        throw new Error(`fake: or() op ${op}`);
      }),
    );
  }
  order(c, o = {}) {
    this.sorts.push([c, o.ascending !== false]);
  }
  range(a, b) {
    this.from = a;
    this.to = b;
  }
  limit(k) {
    this.lim = k;
  }
  run() {
    const rows = db[this.table];
    if (!rows) return { data: null, error: { message: `no table ${this.table}` } };
    // A failure a check asked for: the next such request on that table.
    const fault = faults.findIndex((f) => f.table === this.table && f.op === this.op);
    if (fault >= 0) {
      faults.splice(fault, 1);
      return { data: null, error: { message: "fake: failed on purpose" }, count: null };
    }
    const match = (r) => this.filters.every((f) => f(r));
    if (this.op === "insert" || this.op === "upsert") {
      const made = [];
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const pk = PRIMARY[this.table];
        const row = { ...(pk ? {} : { id: randomUUID() }), created_at: nowIso(), ...p };
        if (this.table === "email_consent_log") row.at ??= nowIso();
        if (this.table === "email_events") row.received_at ??= nowIso();
        if (this.table === "member_email_prefs") Object.assign(row, { lineup: true, alerts: true, events: true, offers: true, rewards: true, consent_source: "unknown", engagement: "active", ...p });
        if (this.table === "email_campaigns") Object.assign(row, { links: [], excluded: {}, holdout_pct: 0, contains_archive: false, recipients: null, held_out: null, updated_at: nowIso(), ...p });
        const onConflict = this.upsertOpts?.onConflict;
        const existing = onConflict ? rows.find((x) => onConflict.split(",").every((c) => x[c] === row[c])) : clash(this.table, row, rows);
        if (existing) {
          if (this.op === "upsert" && this.upsertOpts?.ignoreDuplicates) continue;
          if (this.op === "upsert") {
            Object.assign(existing, p);
            made.push(existing);
            continue;
          }
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(row);
        made.push(row);
      }
      return this.returning || this.one ? this.shape(made) : { data: null, error: null };
    }
    if (this.op === "update") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, this.payload);
      return this.returning || this.one ? this.shape(hit) : { data: null, error: null };
    }
    if (this.op === "delete") {
      const gone = rows.filter(match);
      const keep = rows.filter((r) => !match(r));
      rows.splice(0, rows.length, ...keep);
      return this.returning ? this.shape(gone) : { data: null, error: null };
    }
    let out = rows.filter(match);
    if (this.sorts.length) {
      out = [...out].sort((a, b) => {
        for (const [c, asc] of this.sorts) {
          const d = cmp(get(a, c), get(b, c));
          if (d) return asc ? d : -d;
        }
        return 0;
      });
    }
    const count = out.length;
    if (this.from !== null) out = out.slice(this.from, this.to + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    if (this.opts.head) return { data: null, error: null, count };
    return { ...this.shape(out), ...(this.opts.count ? { count } : {}) };
  }
  shape(list) {
    const copy = list.map((r) => structuredClone(r));
    if (this.one === "maybe") return { data: copy[0] ?? null, error: null };
    if (this.one === "one") return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: "not exactly one row" } };
    return { data: copy, error: null };
  }
}

function chainFor(q) {
  const chain = new Proxy(q, {
    get(target, prop) {
      if (prop === "then")
        return (resolve, reject) => {
          try {
            resolve(target.run());
          } catch (e) {
            reject(e);
          }
        };
      if (prop === "single") return () => ((target.one = "one"), chain);
      if (prop === "maybeSingle") return () => ((target.one = "maybe"), chain);
      const v = target[prop];
      return typeof v === "function" ? (...a) => (v.apply(target, a), chain) : v;
    },
  });
  return chain;
}

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ---- the migration's functions, in JS ----
const RPC = {
  rate_limit_hit: () => ({ data: null, error: { message: "fake: use the memory fallback" } }),
  email_claim_campaign({ p_campaign, p_seconds }) {
    const c = db.email_campaigns.find((x) => x.id === p_campaign);
    const now = Date.now();
    const free = !c?.locked_until || Date.parse(c.locked_until) < now;
    const auto = !!c?.automation || c?.kind === "automation";
    const ok = c && (!auto ? c.status === "scheduled" || (c.status === "sending" && free) : c.status === "active" && free);
    if (!ok) return { data: false, error: null };
    if (!auto) c.status = "sending";
    c.locked_until = new Date(now + Math.max(p_seconds, 30) * 1000).toISOString();
    return { data: true, error: null };
  },
  email_queue_sends({ p_campaign, p_rows }) {
    let n = 0;
    for (const r of p_rows ?? []) {
      if (!["queued", "held_out"].includes(r.status)) continue;
      const key = r.dedupe_key || null;
      const dup = key
        ? db.email_sends.some((s) => s.member_id === r.member_id && s.dedupe_key === key)
        : db.email_sends.some((s) => s.campaign_id === p_campaign && s.member_id === r.member_id && !s.dedupe_key);
      if (dup) continue;
      db.email_sends.push({
        id: randomUUID(),
        campaign_id: p_campaign,
        member_id: r.member_id,
        status: r.status,
        dedupe_key: key,
        deliver_at: r.deliver_at,
        tier_at_send: r.tier_at_send,
        had_login: r.had_login ?? null,
        resend_email_id: null,
        batch_no: null,
        submitted_at: null,
        delivered_at: null,
        first_opened_at: null,
        opens: 0,
        first_clicked_at: null,
        last_clicked_at: null,
        clicks: 0,
        bounced_at: null,
        bounce_type: null,
        complained_at: null,
        unsubscribed_at: null,
        error: null,
        created_at: nowIso(),
      });
      n++;
    }
    return { data: n, error: null };
  },
  email_mark_submitted({ p_rows }) {
    let n = 0;
    for (const r of p_rows ?? []) {
      const s = db.email_sends.find((x) => x.id === r.id && x.status === "queued");
      if (!s) continue;
      Object.assign(s, { resend_email_id: r.resend_email_id ?? s.resend_email_id, status: r.status, submitted_at: r.submitted_at, deliver_at: r.deliver_at ?? s.deliver_at, error: r.error ?? null });
      n++;
    }
    return { data: n, error: null };
  },
  email_bump_send({ p_send, p_what, p_at }) {
    const s = db.email_sends.find((x) => x.id === p_send);
    if (!s) return { data: null, error: null };
    if (p_what === "open") {
      s.opens++;
      s.first_opened_at ??= p_at;
    } else {
      s.clicks++;
      s.first_clicked_at ??= p_at;
      s.last_clicked_at = p_at;
      let p = db.member_email_prefs.find((x) => x.member_id === s.member_id);
      if (!p) db.member_email_prefs.push((p = { member_id: s.member_id, lineup: true, alerts: true, events: true, offers: true, rewards: true, consent_source: "unknown", engagement: "active" }));
      p.last_engaged_at = p_at;
    }
    return { data: s.member_id, error: null };
  },
  member_genre_days: () => ({ data: [], error: null }),
  member_email_facts({ p_offset = 0, p_limit = 1000, p_member = null, p_after = null }) {
    const members = db.members
      .filter((m) => !m.erased_at && m.email && (!p_member || m.id === p_member) && (!p_after || m.id > p_after))
      .sort((a, b) => cmp(a.id, b.id))
      .slice(p_offset, p_offset + p_limit);
    const rows = members.map((m) => {
      const p = db.member_email_prefs.find((x) => x.member_id === m.id);
      const hash = sha(m.email.trim().toLowerCase());
      const sup = db.email_suppressions.find((s) => s.email_hash === hash);
      const sends = db.email_sends
        .filter((s) => s.member_id === m.id)
        .map((s) => {
          const c = db.email_campaigns.find((x) => x.id === s.campaign_id) ?? {};
          return { c: s.campaign_id, t: s.deliver_at ?? s.submitted_at ?? s.created_at, k: c.kind, a: c.automation ?? null, g: c.category, x: c.content?.alert ?? null, s: s.status, ck: !!s.first_clicked_at };
        });
      const days = db.member_visits.filter((v) => v.member_id === m.id).map((v) => v.business_date);
      return {
        member_id: m.id,
        email: m.email,
        email_hash: hash,
        name: m.name,
        tier: m.tier ?? "Insiders",
        legacy_plus: !!m.legacy_plus,
        legacy_user_id: m.legacy_user_id ?? null,
        indy_user_id: m.indy_user_id ?? null,
        has_login: !!m.auth_user_id,
        has_phone: !!m.phone,
        created_at: m.created_at ?? nowIso(),
        imported_at: m.imported_at ?? null,
        birthday: m.birthday ?? null,
        email_opt_in: m.email_opt_in !== false,
        email_opt_in_changed_at: m.email_opt_in_changed_at ?? null,
        has_prefs: !!p,
        lineup: p?.lineup ?? true,
        alerts: p?.alerts ?? true,
        events: p?.events ?? true,
        offers: p?.offers ?? true,
        rewards: p?.rewards ?? true,
        paused_until: p?.paused_until ?? null,
        consent_source: p?.consent_source ?? "unknown",
        import_group: p?.import_group ?? null,
        engagement: p?.engagement ?? "active",
        reconfirm_sent_at: p?.reconfirm_sent_at ?? null,
        last_engaged_at: p?.last_engaged_at ?? null,
        suppressed: sup?.reason ?? null,
        visit_days: days,
        archive_days: [],
        first_visit_on: days.length ? [...days].sort()[0] : null,
        last_visit_on: days.length ? [...days].sort().at(-1) : null,
        tickets: [],
        orders: [],
        last_click_at: null,
        sends,
        delivered_since_engaged: 0,
        invite_delivered: false,
      };
    });
    return { data: rows, error: null };
  },
};

export function createAdminClient() {
  return {
    from: (table) => chainFor(new Query(table)),
    rpc: async (name, args) => {
      const fn = RPC[name];
      if (!fn) return { data: null, error: { message: `fake has no rpc ${name}`, code: "PGRST202" } };
      return fn(args ?? {});
    },
  };
}

// ---------------- Resend REST API ----------------
// An address containing "reject" is refused (422), the way Resend refuses
// a malformed `to`: the whole batch, or that one email alone. onBatch runs
// after each accepted batch (to change things mid-run).
// cancelGone: ids Resend has already sent (a cancel is refused with 422).
// cancel404Once: ids whose next cancel answers 404 though Resend still
// holds them (a lost or early answer). onCancel runs before each cancel
// request (to move a test's clock on).
// batchRejectsSchedule / singleRejectsSchedule: the batch endpoint, or
// POST /emails, refuses scheduled_at (422). ignoreSchedule: Resend takes
// scheduled_at but sends at once (GET shows no scheduled_at).
// acceptThenTimeout: the next batch is taken, but the answer never comes
// (a network error). rateLimitNext: that many batch requests answer 429.
export const resend = {
  sent: [],
  batches: 0,
  keys: new Map(),
  calls: [],
  cancelled: [],
  acceptThenFail: 0,
  acceptThenTimeout: 0,
  rateLimitNext: 0,
  failNext: 0,
  cancelFailNext: 0,
  cancelGone: new Set(),
  cancel404Once: new Set(),
  batchRejectsSchedule: false,
  singleRejectsSchedule: false,
  ignoreSchedule: false,
  onBatch: null,
  onCancel: null,
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SCHEDULE_REFUSED = { name: "validation_error", message: "The `scheduled_at` field is not supported here." };

export async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  if (u.hostname !== "api.resend.com") throw new Error(`unexpected fetch ${url}`);
  const method = init.method ?? "GET";
  const path = u.pathname;
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  resend.calls.push(`${method} ${path}`);
  let m;
  const take = (item) => {
    const id = `re_${randomUUID()}`;
    resend.sent.push({ ...item, id, ...(resend.ignoreSchedule ? { scheduled_at: undefined, ignored: item.scheduled_at } : {}) });
    return id;
  };
  if (method === "POST" && path === "/emails/batch") {
    // (A lost answer comes first: then the 429s, on the tries after it.)
    if (resend.rateLimitNext > 0 && !resend.acceptThenTimeout) {
      resend.rateLimitNext--;
      return new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    }
    const key = headers["idempotency-key"];
    const bodyHash = sha(init.body);
    if (key && resend.keys.has(key)) {
      const prior = resend.keys.get(key);
      if (prior.bodyHash !== bodyHash) return json(409, { name: "invalid_idempotent_request", message: "different payload" });
      return json(200, prior.response);
    }
    if (resend.failNext > 0) {
      resend.failNext--;
      return json(500, { name: "application_error", message: "boom" });
    }
    const items = JSON.parse(init.body);
    if (items.some((it) => it.to.some((t) => t.includes("reject")))) return json(422, { name: "validation_error", message: "Invalid `to` field. The email address needs to follow the `email@example.com` format." });
    if (resend.batchRejectsSchedule && items.some((it) => it.scheduled_at)) return json(422, SCHEDULE_REFUSED);
    const response = { data: items.map((it) => ({ id: take(it) })) };
    resend.batches++;
    if (key) resend.keys.set(key, { bodyHash, response });
    if (resend.onBatch) await resend.onBatch(items);
    if (resend.acceptThenFail > 0) {
      resend.acceptThenFail--;
      return json(502, { name: "application_error", message: "lost on the way back" });
    }
    if (resend.acceptThenTimeout > 0) {
      resend.acceptThenTimeout--;
      throw new TypeError("fetch failed (timed out)");
    }
    return json(200, response);
  }
  if (method === "POST" && path === "/emails") {
    const body = JSON.parse(init.body);
    const key = headers["idempotency-key"];
    const bodyHash = sha(init.body);
    if (key && resend.keys.has(key)) {
      const prior = resend.keys.get(key);
      if (prior.bodyHash !== bodyHash) return json(409, { name: "invalid_idempotent_request", message: "different payload" });
      return json(200, prior.response);
    }
    if (resend.singleRejectsSchedule && body.scheduled_at) return json(422, SCHEDULE_REFUSED);
    const id = take(body);
    resend.sent[resend.sent.length - 1].single = true;
    const response = { id };
    if (key) resend.keys.set(key, { bodyHash, response });
    return json(200, response);
  }
  if ((m = path.match(/^\/emails\/([^/]+)\/cancel$/)) && method === "POST") {
    if (resend.onCancel) await resend.onCancel(m[1]);
    // cancelFailNext: Resend busy for that many cancel requests.
    if (resend.cancelFailNext > 0) {
      resend.cancelFailNext--;
      return json(503, { name: "application_error", message: "busy" });
    }
    if (resend.cancel404Once.has(m[1])) {
      resend.cancel404Once.delete(m[1]);
      return json(404, { name: "not_found", message: "Email not found" });
    }
    const known = resend.sent.find((e) => e.id === m[1]);
    if (resend.cancelGone.has(m[1]) || resend.cancelled.includes(m[1]) || (known && !known.scheduled_at)) return json(422, { name: "validation_error", message: "This email can't be canceled." });
    resend.cancelled.push(m[1]);
    return json(200, { object: "email", id: m[1] });
  }
  if ((m = path.match(/^\/emails\/([^/]+)$/)) && method === "GET") {
    const known = resend.sent.find((e) => e.id === m[1]);
    if (!known) return json(404, { name: "not_found", message: "Email not found" });
    const last = resend.cancelled.includes(m[1]) ? "canceled" : resend.cancelGone.has(m[1]) ? "delivered" : known.scheduled_at ? "scheduled" : "sent";
    return json(200, { object: "email", id: m[1], last_event: last, scheduled_at: known.scheduled_at ?? null });
  }
  return json(404, { name: "not_found", message: `fake has no ${method} ${path}` });
}
// ---------------- next/server, next/cache ----------------
const pending = [];
export function after(fn) {
  pending.push(Promise.resolve().then(fn));
}
export async function flushAfter() {
  while (pending.length) await pending.shift();
}
export const NextResponse = { json: (body, init) => Response.json(body, init) };
export function revalidatePath() {}

// ---------------- @/lib/auth (a signed-in admin) ----------------
export const staff = { employeeId: "e0000000-0000-4000-8000-000000000001", name: "Test Admin", role: "admin", email: "admin@example.com" };
export async function assertStaff() {
  return staff;
}
export const assertManager = assertStaff;
export const assertAdmin = assertStaff;
export const assertOwner = assertStaff;
export const isOwner = () => true;
export const requireManager = assertStaff;
export const requireAdmin = assertStaff;
export const requireStaff = assertStaff;
export const getStaffSession = assertStaff;
export const hasAdminAccess = () => true;
export const hasManagerAccess = () => true;

// ---------------- @/lib/data/lineup ----------------
export const LINEUP_MAX_DAYS = 14;
export const LINEUP_DEFAULT_DAYS = 7;
let lineup = { films: [], happenings: [] };
export function setLineup(l) {
  lineup = l;
}
export async function getLineup(start, days) {
  return { ...lineup, rangeStart: start, rangeDays: days };
}
