"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { markNotFound } from "@/lib/usage-client";

// Put on the "not found" page: tells the usage count (UsageTracker) that
// this address was a miss, so Reports -> Website usage can list dead links
// apart from real pages.
export default function UsageNotFound() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) markNotFound(pathname);
  }, [pathname]);
  return null;
}
