"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { linkMemberAccount } from "../actions";

// Landing point for the magic-link email. Handles both auth flow types
// Supabase might issue: PKCE (?code= in the query string, exchanged via
// exchangeCodeForSession) and implicit (#access_token=&refresh_token= in
// the URL hash, applied via setSession -- hashes never reach the server, so
// this has to happen client-side and can't be read automatically on first
// render before the client library has initialized).
export default function AccountCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashError = hashParams.get("error_description");

      if (hashError) {
        setError(hashError.replace(/\+/g, " "));
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          setError(error.message);
          return;
        }
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) {
          setError(error.message);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError("This sign-in link is invalid or has expired. Please request a new one.");
        return;
      }

      const result = await linkMemberAccount();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace("/account");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount to process the URL Supabase redirected to
  }, []);

  return (
    <div className="mx-auto max-w-sm text-center">
      {error ? (
        <div className="notice notice-warn">
          <p>{error}</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">Signing you in...</p>
      )}
    </div>
  );
}
