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
            const result = await startBillingPortal();
            if (!result.ok) {
              setError(result.error);
              setPending(false);
              return;
            }
            window.location.href = result.url;
          } catch {
            setError("Something went wrong.");
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
