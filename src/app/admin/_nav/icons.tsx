// The few line icons the back office menu uses. Drawn in currentColor.

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function MenuIcon() {
  return (
    <svg {...base}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg {...base} width={16} height={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Today, in the slim menu.
export function HomeIcon() {
  return (
    <svg {...base}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v11h5v-6h4v6h5V9" />
    </svg>
  );
}

// The register: a receipt.
export function RegisterIcon() {
  return (
    <svg {...base}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  );
}

// The menu down the side, with an arrow: `hide` points in (fold it away),
// otherwise out (keep it open).
export function SidebarIcon({ hide }: { hide: boolean }) {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d={hide ? "m16 10-2 2 2 2" : "m14 10 2 2-2 2"} />
    </svg>
  );
}
