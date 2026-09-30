"use client";

import { SearchIcon } from "./icons";

// Opens Find anything from anywhere on a back-office page (the menu listens
// for this; see AdminShell).
export const FIND_EVENT = "rcl:find-anything";

export function openFind() {
  window.dispatchEvent(new Event(FIND_EVENT));
}

export default function FindButton({ className = "btn-secondary", label = "Find anything" }: { className?: string; label?: string }) {
  return (
    <button type="button" className={`inline-flex min-h-11 items-center gap-2 ${className}`} onClick={openFind}>
      <SearchIcon size={16} />
      {label}
    </button>
  );
}
