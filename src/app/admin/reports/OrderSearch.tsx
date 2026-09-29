"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Find one order by its number (the one on the receipt). By date is the
// day picker next to this.
export default function OrderSearch({ initial }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");

  function go() {
    const n = value.replace(/\D/g, "");
    router.push(n ? `/admin/reports?order=${n}` : "/admin/reports");
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input
        aria-label="Order number"
        inputMode="numeric"
        placeholder="Order #"
        className="w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
      />
      <button type="submit" className="chip !px-3 !py-1 !text-sm" disabled={!value}>
        Find
      </button>
    </form>
  );
}
