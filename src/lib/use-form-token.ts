"use client";

import { useEffect, useRef } from "react";
import type { GuardedForm } from "@/lib/public-form-guard";
import { publicFormToken } from "@/lib/public-form-token";

// Asks for the form's bot-check stamp (lib/public-form-token.ts) when the
// form first shows. Returns a function for the submit handler that gives
// the stamp, waiting for it if the answer isn't back yet (null if it never
// came: the server then asks them to refresh the page).
export function useFormToken(form: GuardedForm): () => Promise<string | null> {
  const token = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    token.current = publicFormToken(form).catch(() => null);
  }, [form]);
  return () => token.current ?? Promise.resolve(null);
}
