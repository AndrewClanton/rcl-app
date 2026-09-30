// Splitting a day's tips (Reports -> Day -> Tips). Plain functions, used by
// the screen (to show the three ways side by side) and by the server action
// that records a payout. Everything is worked in cents, so a split always
// adds up to the day's tips exactly: each person gets their share rounded
// down, and the cents left over go to the first person in the list.

export type TipMethod = "even" | "hours" | "rang";

export const TIP_METHODS: { key: TipMethod; label: string; about: string }[] = [
  { key: "even", label: "Even", about: "The same to everyone who worked that day." },
  { key: "hours", label: "By hours", about: "In proportion to the hours each person worked that day." },
  { key: "rang", label: "By who rang it", about: "Each tip to the cashier picked on the register for that sale." },
];

export function isTipMethod(v: unknown): v is TipMethod {
  return v === "even" || v === "hours" || v === "rang";
}

// A login that isn't one person: the register iPad's shared "Royale Cinema
// Lounge" account, or a display screen. Sales rung under it have no one to
// credit, so "by who rang it" leaves their tips unassigned; the other two
// ways just put them in the pool.
export function isSharedLogin(e: { name: string; role: string }): boolean {
  return e.role === "display" || isRegisterLogin(e);
}

// Just the register iPad's shared login, whatever its role.
export function isRegisterLogin(e: { name: string }): boolean {
  return /^royale cinema lounge$/i.test(e.name.trim());
}

export function cents(n: number): number {
  return Math.round(n * 100);
}

// Card tips and cash tips, in cents. A tip is "card" unless the sale was
// paid in cash alone (the register asks for a tab's tip on screen, so a tab
// closed in cash can carry one).
export interface Kinds {
  card: number;
  cash: number;
}

export function tipKind(o: { source: string; cash: number; card: number }): keyof Kinds {
  return o.source === "pos" && o.cash > 0 && o.card <= 0 ? "cash" : "card";
}

// `total` split by `weights`. Each part is rounded down to the cent, and
// what's left goes to the first one with a weight.
export function allocate(total: number, weights: number[]): { parts: number[]; leftover: number; leftoverTo: number } {
  const sum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (total <= 0 || sum <= 0) return { parts: weights.map(() => 0), leftover: 0, leftoverTo: -1 };
  const parts = weights.map((w) => (w > 0 ? Math.floor((total * w) / sum) : 0));
  const leftover = total - parts.reduce((s, p) => s + p, 0);
  const leftoverTo = weights.findIndex((w) => w > 0);
  parts[leftoverTo] += leftover;
  return { parts, leftover, leftoverTo };
}

export interface SplitPerson {
  id: string;
  name: string;
  hours: number; // counted for "by hours"
  rang: Kinds; // tips on the sales they rang, in cents
}

export interface SplitShare {
  id: string;
  name: string;
  card: number; // cents
  cash: number;
  total: number;
}

export interface SplitResult {
  method: TipMethod;
  shares: SplitShare[];
  unassigned: Kinds; // cents nobody in the split gets
  leftovers: { kind: keyof Kinds; cents: number; to: string }[];
}

// `people` are the ones ticked, in order (the first gets leftover cents).
// `pool` is all the day's tips, in cents.
export function splitTips(method: TipMethod, people: SplitPerson[], pool: Kinds): SplitResult {
  const leftovers: SplitResult["leftovers"] = [];
  const byKind = (kind: keyof Kinds): number[] => {
    if (method === "rang") return people.map((p) => p.rang[kind]);
    const weights = people.map((p) => (method === "even" ? 1 : Math.max(0, p.hours)));
    const a = allocate(pool[kind], weights);
    if (a.leftover > 0) leftovers.push({ kind, cents: a.leftover, to: people[a.leftoverTo].name });
    return a.parts;
  };
  const card = byKind("card");
  const cash = byKind("cash");
  const shares = people.map((p, i) => ({ id: p.id, name: p.name, card: card[i], cash: cash[i], total: card[i] + cash[i] }));
  const given = (k: keyof Kinds) => (k === "card" ? card : cash).reduce((s, c) => s + c, 0);
  return { method, shares, unassigned: { card: pool.card - given("card"), cash: pool.cash - given("cash") }, leftovers };
}

// ---------- who was on, and for how long ----------
// Hours for "by hours" come from the register's shift bar, which people
// forget to use. So, flagged on screen each time it happens:
// - a shift carried over from an earlier day counts from the register's
//   first sale of this day (not from 4 a.m.);
// - a shift that was never ended counts until now while the day is still
//   going, and until the register's last sale once it's over (so does one
//   ended the next day, well after 4 a.m.);
// - sales someone rang outside their shift stretch it to cover them; with
//   no shift at all, their first to last sale is what counts.

export interface ShiftIn {
  employeeId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface SaleIn {
  employeeId: string | null;
  at: string;
}

export interface Presence {
  employeeId: string;
  hours: number;
  from: number | null; // ms, the counted stretch's start (for ordering)
  onShift: boolean; // a shift overlapped the day
  sales: number; // sales they rang
  carried: boolean; // a shift started on an earlier day
  neverEnded: boolean; // a shift was never ended
  stretched: boolean; // sales outside their shift (or no shift) counted
  staleOnly: boolean; // only an old shift, still open, and no sales today
  notes: string[];
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function unionMs(spans: [number, number][]): number {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const s of sorted) {
    if (!cur || s[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [s[0], s[1]];
    } else cur[1] = Math.max(cur[1], s[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

export function presence(window: { start: string; end: string; now: string }, shifts: ShiftIn[], sales: SaleIn[]): Map<string, Presence> {
  const start = new Date(window.start).getTime();
  const end = new Date(window.end).getTime();
  const now = new Date(window.now).getTime();
  const over = now >= end;
  const limit = Math.min(end, now);
  const saleTimes = sales.map((s) => new Date(s.at).getTime()).sort((a, b) => a - b);
  const firstSale = saleTimes[0] ?? null;
  const lastSale = saleTimes[saleTimes.length - 1] ?? null;

  // `fresh`: a shift that began this day or ended in it (not just an old one left open).
  const people = new Map<string, { spans: [number, number][]; own: number[]; fresh: boolean; p: Presence }>();
  const get = (id: string) => {
    let e = people.get(id);
    if (!e) {
      e = { spans: [], own: [], fresh: false, p: { employeeId: id, hours: 0, from: null, onShift: false, sales: 0, carried: false, neverEnded: false, stretched: false, staleOnly: false, notes: [] } };
      people.set(id, e);
    }
    return e;
  };

  for (const s of shifts) {
    const e = get(s.employeeId);
    const began = new Date(s.startedAt).getTime();
    const ended = s.endedAt ? new Date(s.endedAt).getTime() : null;
    if (began >= end || (ended !== null && ended <= start)) continue;
    e.p.onShift = true;
    const carried = began < start;
    if (!carried || ended !== null) e.fresh = true;
    // Ended well after 4 a.m. the next morning: left open overnight, most
    // likely. (A close that runs a little past 4 just stops at 4.)
    const spilled = ended !== null && ended > end + 2 * 3_600_000;
    let from = carried ? Math.max(start, firstSale ?? limit) : began;
    let to = ended !== null && !spilled ? ended : over ? (lastSale ?? from) : now;
    to = Math.min(to, limit);
    from = Math.min(from, to);
    if (carried) {
      e.p.carried = true;
      e.p.notes.push(`Shift started ${new Date(began).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Chicago" })}; counted from the day's first sale${firstSale ? ` (${clock(firstSale)})` : ""}.`);
    }
    if (ended === null) {
      e.p.neverEnded = true;
      e.p.notes.push(over ? `Shift never ended; counted to the day's last sale${lastSale ? ` (${clock(lastSale)})` : ""}.` : "Shift still open; counted to now.");
    } else if (spilled) {
      e.p.notes.push(`Shift ran past 4 a.m.; counted to the day's last sale${lastSale ? ` (${clock(lastSale)})` : ""}.`);
    }
    e.spans.push([from, to]);
  }

  for (const s of sales) {
    if (!s.employeeId) continue;
    const e = get(s.employeeId);
    e.own.push(new Date(s.at).getTime());
    e.p.sales++;
  }

  for (const e of people.values()) {
    const own = e.own.sort((a, b) => a - b);
    if (own.length) {
      const [a, b] = [own[0], own[own.length - 1]];
      const inside = e.spans.some(([f, t]) => a >= f && b <= t);
      if (!inside) {
        e.p.stretched = true;
        e.p.notes.push(e.p.onShift ? `Rang sales outside their shift (${clock(a)}–${clock(b)}); counted those too.` : `No shift; counted from their first to last sale (${clock(a)}–${clock(b)}).`);
        e.spans.push([a, b]);
      }
    }
    e.p.hours = unionMs(e.spans) / 3_600_000;
    e.p.from = e.spans.length ? Math.min(...e.spans.map(([f]) => f)) : null;
    e.p.staleOnly = e.p.onShift && !e.fresh && e.p.sales === 0;
  }
  return new Map([...people.entries()].map(([id, e]) => [id, e.p]));
}
