"use client";

import { useState } from "react";
import { startBillingPortal } from "./actions";

export default function BillingPortalButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="text-right">
      <button
        className="btn-secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const { url } = await startBillingPortal();
            window.location.href = url;
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong.");
            setPending(false);
          }
        }}
      >
        {pending ? "Loading..." : "Manage subscription"}
      </button>
      {error && <div className="mt-1 text-xs text-[var(--danger-text)]">{error}</div>}
    </div>
  );
}
