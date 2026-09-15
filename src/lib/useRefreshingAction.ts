"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

// Server Actions invoked programmatically (not via a <form action>) don't
// automatically refresh the current route's server-rendered data even after
// calling revalidatePath. This wraps a mutation with router.refresh() so
// admin screens reflect the write immediately instead of only on next nav.
export function useRefreshingAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  return [pending, run] as const;
}
