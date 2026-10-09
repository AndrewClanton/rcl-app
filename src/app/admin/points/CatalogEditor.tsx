"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PERK_OPTIONS,
  SECTION_LABEL,
  SLOT_LABEL,
  groupRewards,
  guessGoodSection,
  isGoodSection,
  isPerkSlot,
  perkOption,
  pointsFor,
  type GoodSection,
  type PerkSlot,
  type RewardKind,
} from "@/lib/rewards";
import { POINTS_PER_REWARD } from "@/lib/loyalty";
import type { CatalogRow } from "@/lib/rewards-server";
import { saveReward, type RewardInput } from "./actions";

// The rewards catalog: one row per reward, tap Edit to change it, or Add a
// reward. A perk picks from the screen's own lists (lib/rewards.ts): a new
// sound or entrance needs code, but its price, name and limits don't.

const money = (n: number | null) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function toInput(r: CatalogRow): RewardInput {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    kind: r.kind,
    section: r.section,
    perkSlot: r.perk_slot,
    perkKey: r.perk_key,
    perkDays: r.perk_days,
    points: r.points,
    realCost: r.real_cost,
    isAlcohol: r.is_alcohol,
    dailyLimit: r.daily_limit,
    monthlyLimit: r.monthly_limit,
    stock: r.stock,
    active: r.active,
    sort: r.sort,
  };
}

const BLANK: RewardInput = {
  id: null,
  name: "",
  description: "",
  kind: "good",
  section: null,
  perkSlot: null,
  perkKey: null,
  perkDays: null,
  points: 40,
  realCost: null,
  isAlcohol: false,
  dailyLimit: 1,
  monthlyLimit: null,
  stock: null,
  active: true,
  sort: 100,
};

export default function CatalogEditor({ rows }: { rows: CatalogRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  // The same sections as Spend points on the customer screen, cheapest first.
  const sections = groupRewards(rows, (r) => r.perk_slot);
  return (
    <div className="space-y-5">
      <button
        type="button"
        className="btn-primary"
        onClick={() => setEditing("new")}
      >
        + Add a reward
      </button>
      {editing === "new" && (
        <RewardForm initial={BLANK} onDone={() => setEditing(null)} />
      )}
      {sections.map((s) => (
        <section
          key={s.section}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
        >
          <h2 className="border-b border-[var(--border)] px-4 py-2.5 text-base font-semibold">
            {s.label}
          </h2>
          {s.groups.map((g) => (
            <div key={g.key}>
              {g.label && (
                <h3 className="border-b border-[var(--border)] px-4 pb-1.5 pt-3 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  {g.label}
                </h3>
              )}
              <ul className="divide-y divide-[var(--border)]">
                {g.items.map((r) => (
                  <li key={r.id} className="px-4 py-2.5">
                    {editing === r.id ? (
                      <RewardForm
                        initial={toInput(r)}
                        onDone={() => setEditing(null)}
                      />
                    ) : (
                      <div
                        className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${r.active ? "" : "opacity-55"}`}
                      >
                        <span className="min-w-0 flex-1 basis-56 font-medium">
                          {r.name}
                          {!r.active && (
                            <span className="ml-2 text-xs font-bold uppercase text-[var(--muted)]">
                              Off
                            </span>
                          )}
                          {r.perk_slot === "mobile" && (
                            <span className="ml-2 text-xs font-bold uppercase text-[var(--muted)]">
                              Coming soon
                            </span>
                          )}
                          <span className="block text-xs text-[var(--muted)]">
                            {r.kind === "perk" && r.perk_slot
                              ? `${SLOT_LABEL[r.perk_slot]} · ${perkOption(r.perk_slot, r.perk_key)?.label ?? r.perk_key} · ${r.perk_days ? `${r.perk_days} days` : "for good"}`
                              : r.description}
                            {r.is_alcohol ? " · 21+, ID checked" : ""}
                          </span>
                        </span>
                        <span className="w-20 tabular-nums font-semibold">
                          {(r.kind === "discount"
                            ? POINTS_PER_REWARD
                            : r.points
                          ).toLocaleString("en-US")}{" "}
                          pts
                        </span>
                        <span className="w-24 text-xs text-[var(--muted)]">
                          Costs us {money(r.real_cost)}
                        </span>
                        <span className="w-40 text-xs text-[var(--muted)]">
                          {[
                            r.daily_limit ? `${r.daily_limit}/day` : null,
                            r.monthly_limit ? `${r.monthly_limit}/month` : null,
                            r.stock !== null ? `${r.stock} left` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No limit"}
                        </span>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => setEditing(r.id)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function RewardForm({
  initial,
  onDone,
}: {
  initial: RewardInput;
  onDone: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState<RewardInput>(initial);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RewardInput>) => {
    setF((x) => ({ ...x, ...patch }));
    setError(null);
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const slot = f.kind === "perk" && isPerkSlot(f.perkSlot) ? f.perkSlot : null;

  async function save() {
    setBusy(true);
    const r = await saveReward(f).catch(() => ({
      ok: false as const,
      error: "That didn't save.",
    }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
    onDone();
  }

  return (
    <div className="grid gap-3 rounded-lg border border-[var(--border)] p-3 text-sm sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="label-xs">Name</span>
        <input
          className="input mt-1 w-full"
          maxLength={60}
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="label-xs">What members see under it</span>
        <input
          className="input mt-1 w-full"
          maxLength={200}
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="label-xs">Type</span>
        <select
          className="input mt-1 w-full"
          value={f.kind}
          disabled={!!f.id}
          onChange={(e) =>
            set({
              kind: e.target.value as RewardKind,
              perkSlot: null,
              perkKey: null,
            })
          }
        >
          <option value="good">Real goods (a $0 line on the order)</option>
          <option value="perk">Vanity perk (unlocks on their account)</option>
          <option value="discount">$5 off</option>
        </select>
      </label>
      {f.kind === "perk" ? (
        <>
          <label className="block">
            <span className="label-xs">Kind of perk</span>
            <select
              className="input mt-1 w-full"
              value={f.perkSlot ?? ""}
              onChange={(e) =>
                set({
                  perkSlot: (e.target.value || null) as PerkSlot | null,
                  perkKey: null,
                })
              }
            >
              <option value="">Pick one</option>
              {(Object.keys(PERK_OPTIONS) as PerkSlot[]).map((s) => (
                <option key={s} value={s}>
                  {SLOT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {slot && (
            <label className="block">
              <span className="label-xs">Which one</span>
              <select
                className="input mt-1 w-full"
                value={f.perkKey ?? ""}
                onChange={(e) => set({ perkKey: e.target.value || null })}
              >
                <option value="">Pick one</option>
                {PERK_OPTIONS[slot].map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="label-xs">Lasts (days, blank for good)</span>
            <input
              className="input mt-1 w-full"
              inputMode="numeric"
              value={f.perkDays ?? ""}
              onChange={(e) => set({ perkDays: num(e.target.value) })}
            />
          </label>
        </>
      ) : f.kind === "good" ? (
        <>
          <label className="block">
            <span className="label-xs">Section on Spend points</span>
            <select
              className="input mt-1 w-full"
              value={
                isGoodSection(f.section) ? f.section : guessGoodSection(f.name)
              }
              onChange={(e) => set({ section: e.target.value as GoodSection })}
            >
              <option value="food">{SECTION_LABEL.food}</option>
              <option value="tickets">{SECTION_LABEL.tickets}</option>
              <option value="big">{SECTION_LABEL.big}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={f.isAlcohol}
              onChange={(e) => set({ isAlcohol: e.target.checked })}
            />
            Alcohol (21+, the register checks ID)
          </label>
        </>
      ) : (
        <p className="self-end pb-2 text-xs text-[var(--muted)]">
          Always {POINTS_PER_REWARD} points: the register&apos;s rule.
        </p>
      )}
      <label className="block">
        <span className="label-xs">Points</span>
        <input
          className="input mt-1 w-full"
          inputMode="numeric"
          disabled={f.kind === "discount"}
          value={f.points}
          onChange={(e) =>
            set({ points: Math.floor(Number(e.target.value) || 0) })
          }
        />
      </label>
      {f.kind === "good" && (
        <label className="block">
          <span className="label-xs">Sells for ($) → points</span>
          <span className="mt-1 flex gap-2">
            <input
              className="input w-full"
              inputMode="decimal"
              placeholder="2.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <button
              type="button"
              className="chip"
              onClick={() =>
                Number(price) > 0 && set({ points: pointsFor(Number(price)) })
              }
            >
              Use
            </button>
          </span>
        </label>
      )}
      <label className="block">
        <span className="label-xs">What one costs us ($)</span>
        <input
          className="input mt-1 w-full"
          inputMode="decimal"
          value={f.realCost ?? ""}
          onChange={(e) => set({ realCost: num(e.target.value) })}
        />
      </label>
      <label className="block">
        <span className="label-xs">Per member a day (blank: no limit)</span>
        <input
          className="input mt-1 w-full"
          inputMode="numeric"
          value={f.dailyLimit ?? ""}
          onChange={(e) => set({ dailyLimit: num(e.target.value) })}
        />
      </label>
      <label className="block">
        <span className="label-xs">Per member a month (blank: no limit)</span>
        <input
          className="input mt-1 w-full"
          inputMode="numeric"
          value={f.monthlyLimit ?? ""}
          onChange={(e) => set({ monthlyLimit: num(e.target.value) })}
        />
      </label>
      <label className="block">
        <span className="label-xs">Stock left (blank: not counted)</span>
        <input
          className="input mt-1 w-full"
          inputMode="numeric"
          value={f.stock ?? ""}
          onChange={(e) => set({ stock: num(e.target.value) })}
        />
      </label>
      <label className="block">
        <span className="label-xs">Order among same-point rewards</span>
        <input
          className="input mt-1 w-full"
          inputMode="numeric"
          value={f.sort}
          onChange={(e) =>
            set({ sort: Math.floor(Number(e.target.value) || 0) })
          }
        />
      </label>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          checked={f.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
        Offered (untick to hide it from members)
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="chip" onClick={onDone}>
          Cancel
        </button>
        {error && (
          <span className="text-sm font-semibold text-[var(--danger-text)]">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
