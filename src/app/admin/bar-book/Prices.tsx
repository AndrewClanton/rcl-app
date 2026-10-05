"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { MenuDouble } from "@/lib/data/barBook";
import { money, plus, pourUpcharge } from "@/lib/bar/double";
import {
  MIXER_KEYS,
  MIXER_RULES,
  SERVE_LABEL,
  TIERS,
  doubleSettingsOf,
  dollars,
  pct,
  readBarPrices,
  ruleExamples,
  shotPrices,
  type BarPrices,
  type MixerKey,
} from "@/lib/bar/pricing";
import { setBarPrices } from "./actions";

// Back office → Bar Book → Prices: every bar price knob in one place (the
// Royale rule, doubles, neat or rocks, mixers, the target pour cost and the
// pour standard), what they come to, and what changed. Owners and admins
// change them; managers see them. Everything shown is worked out from the
// sheet as it's typed, the same functions the register uses.

type Draft = Record<string, string>;

const toDraft = (p: BarPrices): Draft => {
  const d: Draft = { target: String(Math.round(p.target * 1000) / 10) };
  for (const [k, v] of Object.entries(p.serve)) d[`serve.${k}`] = String(v);
  for (const [k, v] of Object.entries(p.level)) d[`level.${k}`] = String(v);
  for (const k of MIXER_KEYS) {
    d[`mixers.${k}.price`] = String(p.mixers[k].price);
    d[`mixers.${k}.names`] = p.mixers[k].names.join(", ");
  }
  for (const [k, v] of Object.entries(p.double)) d[`double.${k}`] = String(v);
  for (const [k, v] of Object.entries(p.pours)) d[`pours.${k}`] = String(v);
  return d;
};

const num = (t: string | undefined) => (t === undefined || t.trim() === "" ? NaN : Number(t));
const names = (t: string | undefined) =>
  (t ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// The draft as the sheet the server checks (NaN for an empty box, so it's
// refused rather than saved as $0).
function fromDraft(d: Draft): BarPrices {
  const group = <K extends string>(prefix: string, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, num(d[`${prefix}.${k}`])])) as Record<K, number>;
  return {
    serve: group("serve", ["shot", "highball", "neat", "cocktail"] as const),
    level: group("level", TIERS),
    mixers: Object.fromEntries(MIXER_KEYS.map((k) => [k, { price: num(d[`mixers.${k}.price`]), names: names(d[`mixers.${k}.names`]) }])) as BarPrices["mixers"],
    double: group("double", ["pourDiscount", "noRecipe", "rounding"] as const),
    pours: group("pours", ["standard", "neat", "double", "wine", "cocktailMax"] as const),
    target: Math.round((num(d.target) / 100) * 1000) / 1000,
  };
}

const oz = (n: number) => `${n} oz`;

export default function Prices({ prices, drinks, canOwn }: { prices: BarPrices; drinks: MenuDouble[]; canOwn: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(prices));
  const [pending, run, error] = useRefreshingAction();
  // What the sheet comes to as typed (a box that isn't a usable number
  // shows its default until it is).
  const live = useMemo(() => {
    const input = fromDraft(draft);
    return readBarPrices(input, input.target);
  }, [draft]);
  const examples = ruleExamples(live);
  const shots = shotPrices(live);
  const ds = doubleSettingsOf(live);
  const changed = JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(prices)));

  const field = (key: string, opts: { prefix?: string; suffix?: string; label: string; wide?: boolean }) => (
    <label className="flex items-center justify-between gap-2 py-1 text-sm">
      <span>{opts.label}</span>
      {canOwn ? (
        <span className="flex shrink-0 items-center gap-1">
          {opts.prefix}
          <input
            className={`input !py-1 text-right ${opts.wide ? "!w-24" : "!w-16"}`}
            inputMode="decimal"
            value={draft[key] ?? ""}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^0-9.]/g, "") })}
            aria-label={opts.label}
          />
          {opts.suffix}
        </span>
      ) : (
        <span className="shrink-0 font-semibold tabular-nums">
          {opts.prefix}
          {draft[key]}
          {opts.suffix ? `${opts.suffix === "%" ? "" : " "}${opts.suffix}` : ""}
        </span>
      )}
    </label>
  );

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" id="prices">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Prices</h2>

      <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-2 text-sm">
          <p className="text-base">
            <strong>The Royale rule: price = serve + level + double + mixer.</strong>
          </p>
          <p>
            Menu drinks keep their menu price. The rule prices what isn&apos;t on the menu: a Bar Book drink rung up off the menu and a &quot;What&apos;s in
            it?&quot; custom drink. The register fills in the rule price and shows the manager&apos;s check under it: what the drink costs, its pour cost, and a
            gentle flag when that&apos;s over our {pct(live.target)} target. Staff can still change the price; below cost still takes a manager&apos;s PIN.
          </p>
          <ul className="space-y-1 tabular-nums">
            {examples.map((e) => (
              <li key={e.name} className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  {e.name} <span className="text-[var(--muted)]">({e.rule?.label})</span>
                </span>
                <strong>{e.rule ? dollars(e.rule.price) : "no rule price"}</strong>
                {e.rule && (
                  <span className="text-xs text-[var(--muted)]">
                    = {e.rule.parts.map((p, i) => `${i ? "+ " : ""}${dollars(p.amount)} ${i ? p.label : p.label.toLowerCase()}`).join(" ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-sm">
          <div className="font-semibold">What changed (Oct 5)</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              Double shots now {TIERS.map((t) => plus(shots[t].double - shots[t].single)).join("/").replace(/\/\+\$/g, "/+")} (a double well shot is{" "}
              {dollars(shots.well.double)}, not {dollars(shots.well.single * 2)}).
            </li>
            <li>Neat or on the rocks: a {oz(live.pours.neat)} pour at the shot price {plus(ds.serveUpcharge)}, one tap on the shot&apos;s order line.</li>
            <li>The off-menu rule: Bar Book drinks off the menu and custom drinks start at the rule price.</li>
            <li>The Manhattan is $10 (done in the menu).</li>
            <li>Beer and wine are unchanged.</li>
          </ul>
        </div>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-[var(--border)] pt-3 md:grid-cols-2 xl:grid-cols-3">
        <Group title="Serve, at well level">
          {field("serve.shot", { label: `${SERVE_LABEL.shot} (${oz(live.pours.standard)})`, prefix: "$" })}
          {field("serve.highball", { label: `${SERVE_LABEL.highball} (${oz(live.pours.standard)} spirit + mixer)`, prefix: "$" })}
          {field("serve.neat", { label: `${SERVE_LABEL.neat} (${oz(live.pours.neat)})`, prefix: "$" })}
          {field("serve.cocktail", { label: `Off-menu cocktail (up to ${oz(live.pours.cocktailMax)} spirit)`, prefix: "$" })}
          <Note>
            One spirit and nothing else is a shot ({oz(live.pours.neat)} and up: neat or rocks). One spirit with only mixers and juices, no liqueur, is a highball.
            Anything else is a cocktail. Rule prices round up to a whole dollar.
          </Note>
        </Group>

        <Group title="Level upcharge">
          {field("level.well", { label: "Well", prefix: "+$" })}
          {field("level.call", { label: "Call", prefix: "+$" })}
          {field("level.premium", { label: "Premium", prefix: "+$" })}
          <Note>
            From the bottle&apos;s name: &quot;Call Vodka&quot; is call, &quot;Premium Tequila&quot; premium, anything else well. A drink takes its highest. Above-premium
            bottles get their own price later.
          </Note>
        </Group>

        <Group title="Mixers">
          {MIXER_KEYS.map((k) => (
            <MixerRow key={k} k={k} draft={draft} canOwn={canOwn} setDraft={setDraft} field={field} />
          ))}
          <Note>
            A name wins over a kind: ginger beer is a mixer, but its name makes it {plus(live.mixers.gingerBeer.price)}. Each line adds its own (a drink with ginger beer
            and an energy drink adds both).
          </Note>
        </Group>

        <Group title="Double">
          {field("double.pourDiscount", { label: "Second pour: the level's shot price less", prefix: "$" })}
          <p className="py-1 text-sm tabular-nums">
            Per {oz(live.pours.standard)}: well {plus(pourUpcharge(live.pours.standard, "well", ds))}, call {plus(pourUpcharge(live.pours.standard, "call", ds))}, premium{" "}
            {plus(pourUpcharge(live.pours.standard, "premium", ds))}
          </p>
          {field("double.noRecipe", { label: "A spirit drink with no recipe", prefix: "+$" })}
          {field("double.rounding", { label: "A drink's double rounds to", prefix: "$", wide: true })}
          <Note>
            A double is twice the spirit; the mixers, juice and garnish stay the same. Shots, neat or rocks pours and cocktails, never beer or wine. A drink adds, for
            each {oz(live.pours.standard)} of its spirit, its level&apos;s shot price less the discount. No spirit uses its liqueur.
          </Note>
        </Group>

        <Group title="The three shots">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1 font-medium"></th>
                <th className="pb-1 text-right font-medium">Single</th>
                <th className="pb-1 text-right font-medium">Double</th>
                <th className="pb-1 text-right font-medium">Neat/rocks</th>
                <th className="pb-1 text-right font-medium">Neat double</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t} className="border-t border-[var(--border)]">
                  <td className="py-1 capitalize">{t}</td>
                  <td className="py-1 text-right">{dollars(shots[t].single)}</td>
                  <td className="py-1 text-right">{dollars(shots[t].double)}</td>
                  <td className="py-1 text-right">{dollars(shots[t].neat)}</td>
                  <td className="py-1 text-right font-semibold">{dollars(shots[t].neatDouble)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>
            Neat or on the rocks is {oz(live.pours.neat)} at the shot price {plus(ds.serveUpcharge)} (the neat serve less the shot serve), and its double adds the
            second pour on {oz(live.pours.neat)}.
          </Note>
        </Group>

        <Group title="Target">
          {field("target", { label: "Target pour cost", suffix: "%" })}
          <Note>The manager&apos;s check flags a rule price over this, with the price cost suggests (cost ÷ target, up to a whole dollar).</Note>
        </Group>

        <Group
          title="Pour standard"
          badge={
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal" style={{ background: "var(--warn-bg)", color: "var(--warn-text)" }}>
              Bar manager signs off
            </span>
          }
        >
          {field("pours.standard", { label: "Standard pour", suffix: "oz" })}
          {field("pours.neat", { label: "Neat or rocks", suffix: "oz" })}
          {field("pours.double", { label: "Double", suffix: "oz" })}
          {field("pours.wine", { label: "Wine", suffix: "oz" })}
          {field("pours.cocktailMax", { label: "Cocktail spirit, up to", suffix: "oz" })}
          <Note>What the rule and the register start from: a custom drink&apos;s spirit and wine, and when one spirit is a neat or rocks pour.</Note>
        </Group>
      </div>

      {canOwn ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
          <button className="btn-primary !px-4 !py-2" disabled={pending || !changed} onClick={() => run(() => setBarPrices(fromDraft(draft)), { quiet: true })}>
            {pending ? "Saving…" : "Save prices"}
          </button>
          {changed && (
            <button className="btn-secondary !px-3 !py-2" disabled={pending} onClick={() => setDraft(toDraft(prices))}>
              Undo changes
            </button>
          )}
          {error && <span className="text-sm font-semibold text-[var(--danger-text)]">{error}</span>}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">An owner or admin can change these.</p>
      )}

      {drinks.length > 0 && (
        <details className="mt-4 border-t border-[var(--border)] pt-3">
          <summary className="cursor-pointer text-sm font-semibold">Each menu drink&apos;s double</summary>
          <table className="mt-2 w-full max-w-xl text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 font-medium">Drink</th>
                <th className="pb-1.5 text-right font-medium">Single</th>
                <th className="pb-1.5 text-right font-medium">Double adds</th>
                <th className="pb-1.5 text-right font-medium">Double</th>
              </tr>
            </thead>
            <tbody>
              {drinks.map((d) => (
                <tr key={d.id} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-2">{d.name}</td>
                  <td className="py-1.5 text-right">{money(d.price)}</td>
                  <td className="py-1.5 text-right">{d.upcharge === null ? <span className="text-xs text-[var(--muted)]">no double</span> : plus(d.upcharge)}</td>
                  <td className="py-1.5 text-right font-semibold">{d.upcharge === null ? "" : money(d.price + d.upcharge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-[var(--muted)]">As saved. No double on beer (it comes in sizes) or wine (a bigger glass or the bottle is).</p>
        </details>
      )}
    </section>
  );
}

function Group({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
        {title}
        {badge}
      </div>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-[var(--muted)]">{children}</p>;
}

// One mixer rule: its price, the names it applies to, and (for the
// included rule) the kinds and colors it covers.
function MixerRow({
  k,
  draft,
  canOwn,
  setDraft,
  field,
}: {
  k: MixerKey;
  draft: Draft;
  canOwn: boolean;
  setDraft: (d: Draft) => void;
  field: (key: string, opts: { prefix?: string; suffix?: string; label: string }) => ReactNode;
}) {
  const rule = MIXER_RULES[k];
  const or = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : (xs[0] ?? ""));
  const covers = [rule.kinds.length ? `whose kind is ${or(rule.kinds)}` : "", rule.families.length ? `whose color is ${or(rule.families)}` : ""].filter(Boolean);
  const key = `mixers.${k}.names`;
  return (
    <div className="border-b border-[var(--border)] py-1 last:border-b-0">
      {field(`mixers.${k}.price`, { label: rule.label, prefix: "+$" })}
      <div className="flex items-center gap-2 pb-1 text-xs text-[var(--muted)]">
        <span className="shrink-0">Names:</span>
        {canOwn ? (
          <input
            className="input !py-0.5 !text-xs"
            value={draft[key] ?? ""}
            placeholder="none"
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            aria-label={`${rule.label}: the ingredient names it applies to, separated by commas`}
          />
        ) : (
          <span className="text-[var(--foreground)]">{draft[key] || "none"}</span>
        )}
      </div>
      {covers.length > 0 && <div className="pb-1 text-xs text-[var(--muted)]">And every ingredient {covers.join(", or ")} (set in Ingredients below).</div>}
    </div>
  );
}
