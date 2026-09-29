// Kitchen order tickets: which items are new since the kitchen was last
// sent this order. A tab's items are rewritten whole on every save (see
// replaceOrderItems in app/pos/actions.ts), so items are matched by what
// they are (name + modifiers), not by row. Pure, so node can test it
// (scripts/check-order-ticket.mjs).

export interface TicketLine {
  name: string;
  qty: number;
  mods: string[];
}

function key(l: TicketLine): string {
  return JSON.stringify([l.name.trim(), l.mods.map((m) => m.trim()).filter(Boolean).sort()]);
}

// Same items added up: "2 x Burger" rung as two lines is one line of 2.
// Keeps the order items were first rung in.
export function tallyLines(lines: TicketLine[]): TicketLine[] {
  const out = new Map<string, TicketLine>();
  for (const l of lines) {
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    if (!qty || !l.name?.trim()) continue;
    const k = key(l);
    const cur = out.get(k);
    if (cur) cur.qty += qty;
    else out.set(k, { name: l.name.trim(), qty, mods: l.mods.map((m) => m.trim()).filter(Boolean) });
  }
  return [...out.values()];
}

// What's in `current` beyond what's in `sent`. Something taken off the
// order after it was sent is simply not new; the kitchen isn't told to
// un-make it.
export function newLines(current: TicketLine[], sent: TicketLine[]): TicketLine[] {
  const had = new Map(tallyLines(sent).map((l) => [key(l), l.qty]));
  const out: TicketLine[] = [];
  for (const l of tallyLines(current)) {
    const extra = l.qty - (had.get(key(l)) ?? 0);
    if (extra > 0) out.push({ ...l, qty: extra });
  }
  return out;
}

export function addLines(a: TicketLine[], b: TicketLine[]): TicketLine[] {
  return tallyLines([...a, ...b]);
}

// `a` less `b`, never below zero (taking a held ticket's items back out of
// what counts as sent).
export function subtractLines(a: TicketLine[], b: TicketLine[]): TicketLine[] {
  return newLines(a, b);
}

// Stored JSON back into lines, dropping anything malformed.
export function readLines(v: unknown): TicketLine[] {
  if (!Array.isArray(v)) return [];
  return tallyLines(
    v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        name: typeof x.name === "string" ? x.name : "",
        qty: typeof x.qty === "number" ? x.qty : 0,
        mods: Array.isArray(x.mods) ? x.mods.filter((m): m is string => typeof m === "string") : [],
      })),
  );
}

export const lineCount = (lines: TicketLine[]) => lines.reduce((n, l) => n + l.qty, 0);
