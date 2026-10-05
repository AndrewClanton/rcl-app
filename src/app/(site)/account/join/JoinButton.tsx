"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinOrganization } from "./actions";

export default function JoinButton({ code, orgName }: { code: string; orgName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <button
        className="btn-primary w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await joinOrganization(code).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
            if (!r.ok) return setError(r.error);
            router.push("/account");
            router.refresh();
          })
        }
      >
        {pending ? "Joining…" : `Join ${orgName} as a helper`}
      </button>
      {error && (
        <p className="notice notice-warn text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
