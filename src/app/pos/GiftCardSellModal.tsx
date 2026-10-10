"use client";

import { useState } from "react";
import { GIFT_CARD_PRESETS, giftAmountProblem } from "@/lib/gift-cards";

// The register's Gift card button: sell a gift card. Pick an amount (or
// type one) and, if there's a member on the order, whether it goes on
// their account. It goes on the order as a "Gift card" line: no tax, no
// discounts, no points, no manager PIN (lib/register-totals.ts). The card
// and its code are made when the sale is paid, and print on the receipt
// and a gift card slip.
export default function GiftCardSellModal({
  memberName,
  onAdd,
  onCancel,
}: {
  // The member on the order, who it can go on (null: none on the order).
  memberName: string | null;
  onAdd: (card: { amount: number; toMember: boolean }) => void;
  onCancel: () => void;
}) {
  const [preset, setPreset] = useState<number | null>(50);
  const [typed, setTyped] = useState("");
  const [toMember, setToMember] = useState(false);
  const amount = typed ? Math.round((parseFloat(typed) || 0) * 100) / 100 : (preset ?? 0);
  const problem = giftAmountProblem(amount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        className="card w-full max-w-xs space-y-3 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) onAdd({ amount, toMember: toMember && !!memberName });
        }}
      >
        <h3 className="text-center text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Gift card
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {GIFT_CARD_PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              className={`chip !py-3 !text-base font-bold ${!typed && preset === v ? "chip-selected" : ""}`}
              onClick={() => {
                setTyped("");
                setPreset(v);
              }}
            >
              ${v}
            </button>
          ))}
        </div>
        <label className="block">
          <div className="label-xs">Other amount</div>
          <input id="gift-card-amount" className="input" inputMode="decimal" placeholder="0.00" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        {typed && problem && (
          <p className="text-xs" style={{ color: "var(--danger-text)" }}>
            {problem}
          </p>
        )}
        {memberName ? (
          <label className="flex items-start gap-2 text-sm">
            <input id="gift-card-member" type="checkbox" className="mt-1" checked={toMember} onChange={(e) => setToMember(e.target.checked)} />
            <span>
              Put it on {memberName}&apos;s account
              <span className="block text-xs" style={{ color: "var(--muted)" }}>
                They&apos;ll see the balance in My Account. Leave it off for a gift to someone else.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            To put it on someone&apos;s account, attach them to the order first. It can be added later in Back office too.
          </p>
        )}
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          No tax on a gift card: tax comes when it&apos;s spent. The code prints when the order is paid.
        </p>
        <div className="flex justify-center gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!!problem}>
            Add{problem ? "" : ` $${amount.toFixed(2)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
