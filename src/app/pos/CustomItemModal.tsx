"use client";

import { useState } from "react";

// A one-off line with any price: something not on the menu yet, a special
// request, or a quick test charge. It isn't added to the menu. Tax and
// member discounts apply like any other line.
export default function CustomItemModal({
  onAdd,
  onCancel,
}: {
  onAdd: (line: { name: string; unit: number; isAlcohol: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [isAlcohol, setIsAlcohol] = useState(false);

  const amount = Math.round((parseFloat(price) || 0) * 100) / 100;
  const valid = amount > 0 && amount < 10000;

  function submit() {
    if (!valid) return;
    onAdd({ name: name.trim() || "Custom item", unit: amount, isAlcohol });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        className="card w-full max-w-xs space-y-3 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 className="text-center text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Custom item
        </h3>
        <label className="block">
          <div className="label-xs">What is it?</div>
          <input id="custom-item-name" className="input" placeholder="Custom item" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="label-xs">Price</div>
          <input
            id="custom-item-price"
            autoFocus
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input id="custom-item-alcohol" type="checkbox" checked={isAlcohol} onChange={(e) => setIsAlcohol(e.target.checked)} />
          Contains alcohol (asks for the ID check)
        </label>
        <div className="flex justify-center gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid}>
            Add{valid ? ` $${amount.toFixed(2)}` : ""}
          </button>
        </div>
      </form>
    </div>
  );
}
