"use client";

import { useState } from "react";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { MenuDouble } from "@/lib/data/barBook";
import { money, plus, type DoubleSettings } from "@/lib/bar/double";
import { setDoubleSettings } from "./actions";

// Back office → Bar Book → Doubles: what a double is, how we price it (in
// plain words, for whoever's behind the bar), what each drink's double
// costs now, and for owners and admins the numbers behind it.
export default function Doubles({ settings, drinks, canOwn }: { settings: DoubleSettings; drinks: MenuDouble[]; canOwn: boolean }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Doubles</h2>
      <div className="mt-2 space-y-2 text-sm">
        <p>
          <strong>What a double is.</strong> Twice the spirit, the bar standard. A 1.5 oz pour becomes 3 oz; in a mixed drink only the
          spirit doubles, and the mixers, juice and garnish stay the same. Tap <strong>Double</strong> on any spirit drink on the order (or in its choices).
        </p>
        <p>
          <strong>How we price it.</strong> A shot&apos;s double is {settings.shotMultiplier === 2 ? "twice" : `${settings.shotMultiplier} times`} the single (a{" "}
          {money(settings.tiers.well)} well shot is {money(settings.tiers.well * settings.shotMultiplier)}). A cocktail adds, for each 1.5 oz of its spirit, its
          tier&apos;s shot price less {money(settings.pourDiscount)}: well {money(settings.tiers.well)}, call {money(settings.tiers.call)}, premium{" "}
          {money(settings.tiers.premium)}, so 1.5 oz of well is {plus(settings.tiers.well - settings.pourDiscount)}, rounded to the nearest{" "}
          {money(settings.rounding)}. A drink with no spirit uses its liqueur (Butter beer&apos;s schnapps). A spirit drink with no recipe is{" "}
          {plus(settings.noRecipeUpcharge)}.
        </p>
        <p>
          <strong>No double on beer or wine.</strong> Beer comes in sizes, and a &quot;double pour&quot; of wine isn&apos;t a thing at a bar; a bigger glass or the
          bottle is.
        </p>
      </div>

      {drinks.length > 0 && (
        <table className="mt-3 w-full max-w-xl text-sm tabular-nums">
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
      )}

      {canOwn ? <Knobs settings={settings} /> : <p className="mt-3 text-xs text-[var(--muted)]">An owner or admin can change these numbers.</p>}
    </section>
  );
}

function Knobs({ settings }: { settings: DoubleSettings }) {
  const [pending, run, error] = useRefreshingAction();
  const [v, setV] = useState({
    shotMultiplier: String(settings.shotMultiplier),
    pourDiscount: String(settings.pourDiscount),
    well: String(settings.tiers.well),
    call: String(settings.tiers.call),
    premium: String(settings.tiers.premium),
    noRecipeUpcharge: String(settings.noRecipeUpcharge),
    rounding: String(settings.rounding),
  });
  const field = (key: keyof typeof v, label: string, prefix = "$") => (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      {prefix}
      <input className="input !w-20 !py-1" inputMode="decimal" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value.replace(/[^0-9.]/g, "") })} />
    </label>
  );
  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            setDoubleSettings({
              shotMultiplier: Number(v.shotMultiplier),
              pourDiscount: Number(v.pourDiscount),
              tiers: { well: Number(v.well), call: Number(v.call), premium: Number(v.premium) },
              noRecipeUpcharge: Number(v.noRecipeUpcharge),
              rounding: Number(v.rounding),
            }),
          { quiet: true },
        );
      }}
    >
      {field("shotMultiplier", "Double shot ×", "")}
      {field("well", "Well shot")}
      {field("call", "Call shot")}
      {field("premium", "Premium shot")}
      {field("pourDiscount", "Less per pour")}
      {field("noRecipeUpcharge", "No recipe")}
      {field("rounding", "Round to")}
      <button className="btn-secondary !px-3 !py-1.5" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-sm font-semibold text-[var(--danger-text)]">{error}</span>}
    </form>
  );
}
