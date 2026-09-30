"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startView } from "@/lib/usage-client";

// Anonymous page-view counting for Reports -> Website usage, mounted once
// in the root layout so it covers the site, accounts, the back office, the
// register and the screens. Draws nothing; how it counts is in
// src/lib/usage-client.ts. Uses only the pathname (never the query), so
// the root layout stays static.
export default function UsageTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) startView(pathname);
  }, [pathname]);
  return null;
}
