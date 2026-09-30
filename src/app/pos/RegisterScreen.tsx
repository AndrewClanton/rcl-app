"use client";

import { useEffect } from "react";
import { useDeviceSettings } from "./devices/settings";

// The register's root: its own tokens (globals.css, .pos-root), and Dim
// from Devices, a darker screen for the bar at night, kept on this iPad
// only. Dim is set on <body> too, so the page edges and help bubbles (drawn
// outside this root) go dark with the rest.
export default function RegisterScreen({ className, children }: { className?: string; children: React.ReactNode }) {
  const { dim } = useDeviceSettings();

  useEffect(() => {
    if (!dim) return;
    document.body.setAttribute("data-register-dim", "");
    return () => document.body.removeAttribute("data-register-dim");
  }, [dim]);

  return (
    <div className={`pos-root ${className ?? ""}`} data-register-dim={dim ? "" : undefined}>
      {children}
    </div>
  );
}
