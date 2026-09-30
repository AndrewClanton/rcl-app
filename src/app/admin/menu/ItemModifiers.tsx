"use client";

import { useState } from "react";
import type { MenuItem } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addModifierGroup, deleteModifierGroup, addModifierOption, updateModifierOption, deleteModifierOption, setModifierGroupMustChoose } from "./actions";

function signedMoney(n: number) {
  return n ? `${n > 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}` : "";
}

export default function ItemModifiers({ item, canEdit }: { item: MenuItem; canEdit: boolean }) {
  const [pending, run] = useRefreshingAction();
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newGroupType, setNewGroupType] = useState<"single" | "multi">("single");

  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-hover)] p-3 ">
      {item.modifier_groups.map((group) => (
        <div key={group.id} className="mb-3 border-b border-[var(--border)] pb-3 last:mb-0 last:border-0 last:pb-0 ">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">
              {group.label}{" "}
              <span className="text-[var(--muted)]">({group.type === "single" ? (group.must_choose ? "choose one, staff must pick" : "choose one") : "choose any"})</span>
            </span>
            {canEdit && (
              <button className="text-xs text-[var(--danger-text)] hover:underline" disabled={pending} onClick={() => run(() => deleteModifierGroup(group.id))}>
                Delete group
              </button>
            )}
          </div>
          {canEdit && group.type === "single" && (
            <label className="mb-1.5 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={!!group.must_choose}
                disabled={pending}
                onChange={(e) => run(() => setModifierGroupMustChoose(group.id, e.target.checked))}
              />
              Staff must pick (nothing chosen until they tap one)
            </label>
          )}
          {canEdit ? (
            <>
              {group.options.map((opt) => (
                <OptionRow key={opt.id} id={opt.id} name={opt.name} priceDelta={opt.price_delta} />
              ))}
              <NewOptionRow groupId={group.id} />
            </>
          ) : (
            <ul className="text-sm">
              {group.options.map((opt) => (
                <li key={opt.id} className="flex gap-2">
                  <span>{opt.name}</span>
                  <span className="text-[var(--muted)]">{signedMoney(Number(opt.price_delta))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">New group label</label>
            <input
              className="rounded border border-[var(--border)] px-2 py-1 text-sm "
              placeholder="e.g. Size"
              value={newGroupLabel}
              onChange={(e) => setNewGroupLabel(e.target.value)}
            />
          </div>
          <select
            className="rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={newGroupType}
            onChange={(e) => setNewGroupType(e.target.value as "single" | "multi")}
          >
            <option value="single">Choose one</option>
            <option value="multi">Choose any</option>
          </select>
          <button
            className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50 "
            disabled={pending || !newGroupLabel.trim()}
            onClick={() => {
              const label = newGroupLabel;
              const type = newGroupType;
              setNewGroupLabel("");
              run(() => addModifierGroup(item.id, label, type));
            }}
          >
            Add modifier group
          </button>
        </div>
      )}
    </div>
  );
}

function OptionRow({ id, name, priceDelta }: { id: string; name: string; priceDelta: number }) {
  const [pending, run] = useRefreshingAction();
  const [localName, setLocalName] = useState(name);
  const [localDelta, setLocalDelta] = useState(String(priceDelta));

  return (
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <input
        className="min-w-[120px] flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => {
          if (localName.trim() && localName !== name) run(() => updateModifierOption(id, { name: localName.trim() }));
        }}
      />
      <input
        type="number"
        step="0.01"
        className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm "
        value={localDelta}
        onChange={(e) => setLocalDelta(e.target.value)}
        onBlur={() => {
          const v = parseFloat(localDelta);
          if (!isNaN(v) && v !== priceDelta) run(() => updateModifierOption(id, { price_delta: v }));
        }}
      />
      <button className="text-xs text-[var(--danger-text)] hover:underline" disabled={pending} onClick={() => run(() => deleteModifierOption(id))}>
        Remove
      </button>
    </div>
  );
}

function NewOptionRow({ groupId }: { groupId: string }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState("");
  const [delta, setDelta] = useState("");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        className="min-w-[120px] flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
        placeholder="Option name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="number"
        step="0.01"
        className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm "
        placeholder="+price"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
      />
      <button
        className="rounded border border-[var(--border)] px-2 py-1 text-xs "
        disabled={pending || !name.trim()}
        onClick={() => {
          const n = name;
          const d = parseFloat(delta) || 0;
          setName("");
          setDelta("");
          run(() => addModifierOption(groupId, n, d));
        }}
      >
        Add option
      </button>
    </div>
  );
}
