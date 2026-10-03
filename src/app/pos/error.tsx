"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { useErrorRecovery } from "@/lib/useErrorRecovery";
import { useUnsavedSale, type UnsavedSale } from "./UnsavedSaleBanner";

// The register's error screen. The cashier needs one thing: a big button
// that gets the register back. It tries retry() first (the page re-fetched
// and re-drawn, no reload) and reloads the whole page if that doesn't take;
// useErrorRecovery has the details, including waiting out a dropped
// connection instead of reloading into the browser's offline page.
//
// A card sale that was charged but didn't save lives in this browser's
// storage (UnsavedSaleBanner), so it survives the reload. Saying so here
// keeps anyone from charging the card a second time. useUnsavedSale reads
// the storage inside a try/catch, so blocked storage just means no note.
export default function PosError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { state, recover } = useErrorRecovery(retry);
  const sale = useUnsavedSale();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="card w-full max-w-xl !p-8 text-center">
        <p className="eyebrow">Register</p>
        <h1 className="font-display mt-2 text-3xl sm:text-4xl">Something went wrong</h1>
        <p className="mt-3 text-base">
          The register screen stopped working. Reloading it usually fixes this. Held orders, open tabs and finished sales are saved and will be there.
        </p>

        {sale && (
          <div role="alert" className="mt-5 rounded-lg border-2 p-4 text-left" style={{ borderColor: "var(--danger-text)", background: "var(--warn-bg)" }}>
            <p className="text-sm font-bold" style={{ color: "var(--danger-text)" }}>
              A card sale didn&apos;t save. Don&apos;t charge the card again.
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--warn-text)" }}>
              {describe(sale)}. It&apos;s kept on this register and will still be there after the reload, above the order total, with Retry saving.
            </p>
          </div>
        )}

        <button
          type="button"
          className="btn-primary mt-6 w-full !py-5 !text-xl"
          disabled={state === "working"}
          onClick={() => void recover()}
        >
          {state === "working" ? "Reloading..." : "Tap to reload"}
        </button>
        {state === "offline" && (
          <p role="status" className="mt-3 text-sm font-bold" style={{ color: "var(--danger-text)" }}>
            Can&apos;t reach the internet. Check the Wi-Fi, then tap again.
          </p>
        )}

        <p className="mt-5 text-sm text-[var(--muted)]">
          An order you were still ringing up (not held or paid yet) may need to be rung up again. If this keeps happening, get a manager.
        </p>
        {error.digest && <p className="mt-2 text-xs text-[var(--muted)]">Reference {error.digest}</p>}
      </div>
    </main>
  );
}

// "Table 4 · $23.50 on the card", the way the banner shows it. What's stored
// came from this browser, but it's still checked: this screen mustn't crash
// too.
function describe(sale: UnsavedSale): string {
  const name = typeof sale.order.orderName === "string" && sale.order.orderName.trim() ? sale.order.orderName.trim() : "Order";
  const card = sale.order.payment.card;
  return typeof card === "number" && Number.isFinite(card) ? `${name} · $${card.toFixed(2)} on the card` : name;
}
