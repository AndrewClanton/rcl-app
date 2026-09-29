// In-memory stand-ins used by scripts/check-mailing-list.mjs: the Supabase
// admin client, Resend's REST API (as a fetch), next/server's after() and
// NextResponse, and the lineup loader. Just enough of each for
// src/lib/mailing-list.ts, src/lib/lineup-send.ts and the Resend webhook.

// ---------------- Supabase (service-role client) ----------------
export const db = { members: [], mailing_list_syncs: [], mailing_sends: [], employees: [] };
let n = 0;
const nextId = () => ++n;
const uuid = () => `00000000-0000-4000-8000-${String(nextId()).padStart(12, "0")}`;
const unescapeLike = (p) => p.replace(/\\([\\%_])/g, "$1");

class Query {
  constructor(table) {
    Object.assign(this, { table, filters: [], op: "select", payload: null, returning: false, opts: {}, one: null, from: null, to: null, lim: null, sort: null });
  }
  select(_cols, opts = {}) {
    if (this.op === "select") this.opts = opts;
    else this.returning = true;
  }
  insert(obj) {
    this.op = "insert";
    this.payload = obj;
  }
  update(obj) {
    this.op = "update";
    this.payload = obj;
  }
  delete() {
    this.op = "delete";
  }
  eq(c, v) {
    this.filters.push((r) => r[c] === v);
  }
  lt(c, v) {
    this.filters.push((r) => r[c] < v);
  }
  gte(c, v) {
    this.filters.push((r) => r[c] >= v);
  }
  is(c, v) {
    this.filters.push((r) => (r[c] ?? null) === v);
  }
  not(c, op, v) {
    if (op !== "is") throw new Error("fake: not() only supports is");
    this.filters.push((r) => (r[c] ?? null) !== v);
  }
  ilike(c, pattern) {
    const want = unescapeLike(pattern).toLowerCase();
    this.filters.push((r) => (r[c] ?? "").toLowerCase() === want);
  }
  or(expr) {
    // e.g. "email_opt_in.eq.false,email_opt_in_changed_at.is.null"
    const parts = expr.split(",").map((p) => p.split("."));
    this.filters.push((r) => parts.some(([c, op, v]) => (op === "eq" ? String(r[c]) === v : op === "is" && v === "null" && (r[c] ?? null) === null)));
  }
  order(c, o = {}) {
    this.sort = [c, o.ascending !== false];
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
    const match = (r) => this.filters.every((f) => f(r));
    if (this.op === "insert") {
      const made = [];
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const row = { id: uuid(), created_at: new Date().toISOString(), ...p };
        if (this.table === "mailing_sends") {
          row.status ??= "sending";
          // The unique send_key and the one-in-flight index.
          if (rows.some((x) => x.send_key === row.send_key)) return { data: null, error: { code: "23505", message: "duplicate send_key" } };
          if (row.status === "sending" && rows.some((x) => x.status === "sending")) return { data: null, error: { code: "23505", message: "one in flight" } };
        }
        if (this.table === "mailing_list_syncs") row.started_at = new Date().toISOString();
        rows.push(row);
        made.push(row);
      }
      return this.shape(made);
    }
    if (this.op === "update") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, this.payload);
      return this.returning || this.one ? this.shape(hit) : { data: null, error: null };
    }
    if (this.op === "delete") {
      const keep = rows.filter((r) => !match(r));
      rows.splice(0, rows.length, ...keep);
      return { data: null, error: null };
    }
    let out = rows.filter(match);
    if (this.sort) {
      const [c, asc] = this.sort;
      out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
    }
    const count = out.length;
    if (this.from !== null) out = out.slice(this.from, this.to + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    if (this.opts.head) return { data: null, error: null, count };
    return { ...this.shape(out), ...(this.opts.count ? { count } : {}) };
  }
  shape(list) {
    const copy = list.map((r) => ({ ...r }));
    if (this.one === "maybe") return { data: copy[0] ?? null, error: null };
    if (this.one === "one") return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: "not exactly one row" } };
    return { data: copy, error: null };
  }
}

export function createAdminClient() {
  return {
    from(table) {
      const q = new Query(table);
      const chain = new Proxy(q, {
        get(target, prop) {
          if (prop === "then") return (resolve, reject) => {
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
    },
  };
}

// ---------------- Resend REST API ----------------
export const resend = { contacts: new Map(), segments: [], broadcasts: new Map(), calls: [], failNext: null, failCount: 0 };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => json(404, { name: "not_found", message: "Not found" });

export async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  if (u.hostname !== "api.resend.com") throw new Error(`unexpected fetch ${url}`);
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  const path = decodeURIComponent(u.pathname);
  resend.calls.push(`${method} ${path}`);
  if (resend.failNext?.(method, path)) {
    if (!(--resend.failCount > 0)) resend.failNext = null;
    return json(500, { name: "application_error", message: "boom" });
  }
  let m;
  if (method === "GET" && path === "/segments") return json(200, { object: "list", has_more: false, data: resend.segments });
  if (method === "POST" && path === "/segments") {
    const s = { id: `seg_${nextId()}`, name: body.name };
    resend.segments.push(s);
    return json(201, { object: "segment", ...s });
  }
  if ((m = path.match(/^\/segments\/([^/]+)\/contacts$/)) && method === "GET") {
    const all = [...resend.contacts.values()].filter((c) => c.segments.has(m[1]));
    const limit = Number(u.searchParams.get("limit") ?? 100);
    const after = u.searchParams.get("after");
    const start = after ? all.findIndex((c) => c.id === after) + 1 : 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const page = all.slice(start, start + limit).map(({ segments, ...c }) => c);
    return json(200, { object: "list", has_more: start + limit < all.length, data: page });
  }
  if (method === "POST" && path === "/contacts") {
    const key = body.email.toLowerCase();
    if (resend.contacts.has(key)) return json(409, { name: "validation_error", message: "Contact already exists" });
    const c = { id: `c_${nextId()}`, email: body.email, first_name: body.first_name ?? null, unsubscribed: !!body.unsubscribed, segments: new Set((body.segments ?? []).map((s) => s.id)) };
    resend.contacts.set(key, c);
    return json(201, { object: "contact", id: c.id });
  }
  if ((m = path.match(/^\/contacts\/([^/]+)\/segments\/([^/]+)$/)) && method === "POST") {
    const c = resend.contacts.get(m[1].toLowerCase());
    if (!c) return notFound();
    c.segments.add(m[2]);
    return json(200, { id: m[2] });
  }
  if ((m = path.match(/^\/contacts\/([^/]+)\/segments$/)) && method === "GET") {
    const c = resend.contacts.get(m[1].toLowerCase());
    return c ? json(200, { object: "list", has_more: false, data: [...c.segments].map((id) => ({ id, name: "x" })) }) : notFound();
  }
  if ((m = path.match(/^\/contacts\/([^/]+)$/))) {
    const key = m[1].toLowerCase();
    const c = resend.contacts.get(key);
    if (!c) return notFound();
    if (method === "GET") return json(200, { object: "contact", id: c.id, email: c.email, first_name: c.first_name, unsubscribed: c.unsubscribed });
    if (method === "PATCH") {
      if ("first_name" in body) c.first_name = body.first_name;
      if ("unsubscribed" in body) c.unsubscribed = body.unsubscribed;
      return json(200, { object: "contact", id: c.id });
    }
    if (method === "DELETE") {
      resend.contacts.delete(key);
      return json(200, { object: "contact", contact: c.id, deleted: true });
    }
  }
  if (method === "POST" && path === "/broadcasts") {
    const b = { id: `b_${nextId()}`, status: "draft", ...body };
    resend.broadcasts.set(b.id, b);
    return json(201, { object: "broadcast", id: b.id });
  }
  if ((m = path.match(/^\/broadcasts\/([^/]+)\/send$/)) && method === "POST") {
    const b = resend.broadcasts.get(m[1]);
    if (!b) return notFound();
    b.status = "queued";
    b.recipients = [...resend.contacts.values()].filter((c) => c.segments.has(b.segment_id) && !c.unsubscribed).map((c) => c.email);
    return json(200, { id: b.id });
  }
  if ((m = path.match(/^\/broadcasts\/([^/]+)$/)) && method === "GET") {
    const b = resend.broadcasts.get(m[1]);
    return b ? json(200, { object: "broadcast", id: b.id, status: b.status }) : notFound();
  }
  if (method === "POST" && path === "/emails") {
    resend.lastEmail = body;
    return json(200, { id: `e_${nextId()}` });
  }
  return json(404, { name: "not_found", message: `fake has no ${method} ${path}` });
}

// ---------------- next/server ----------------
const pending = [];
export function after(fn) {
  pending.push(Promise.resolve().then(fn));
}
export async function flushAfter() {
  while (pending.length) await pending.shift();
}
export const NextResponse = { json: (body, init) => Response.json(body, init) };

// ---------------- @/lib/data/lineup ----------------
export const LINEUP_MAX_DAYS = 14;
let lineup = { films: [], happenings: [] };
export function setLineup(l) {
  lineup = l;
}
export async function getLineup(start, days) {
  return { ...lineup, rangeStart: start, rangeDays: days };
}
