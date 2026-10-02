"use client";

import { useMemo } from "react";
import QRCode from "qrcode";
import { isClaimUrl } from "@/lib/claim-link";
import { isPlusFinishUrl } from "@/lib/plus-finish-link";
import { SITE_URL } from "@/lib/site";
import k from "./kiosk.module.css";

// A "claim your account" link (lib/member-claim.ts), a "finish your
// Insiders+ on your phone" link (lib/plus-finish-link.ts), or the account
// page itself (a member's card, MemberCards.tsx), as a QR code, for the
// customer tablet. Drawn as one SVG path straight from the QR matrix: no
// canvas, no effect, crisp at any size. Only ever one of those links on
// this site -- anything else (a stray or tampered broadcast) draws nothing.
const ACCOUNT_URL = `${SITE_URL}/account`;

function qrPath(url: string): { size: number; d: string } | null {
  if (!isClaimUrl(url) && !isPlusFinishUrl(url) && url !== ACCOUNT_URL) return null;
  try {
    const { size, data } = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
    let d = "";
    for (let r = 0; r < size; r++) {
      let c = 0;
      while (c < size) {
        if (!data[r * size + c]) {
          c++;
          continue;
        }
        const start = c;
        while (c < size && data[r * size + c]) c++;
        d += `M${start} ${r}h${c - start}v1h-${c - start}z`;
      }
    }
    return { size, d };
  } catch {
    return null;
  }
}

// Dark modules on a light tile (inverted codes don't scan on every phone),
// with a two-module quiet zone inside the tile's own padding.
export default function ClaimQr({ url, size, label }: { url: string; size: number; label: string }) {
  const qr = useMemo(() => qrPath(url), [url]);
  if (!qr) return null;
  const q = 2;
  return (
    <div className={k.qr} style={{ lineHeight: 0 }}>
      <svg viewBox={`${-q} ${-q} ${qr.size + 2 * q} ${qr.size + 2 * q}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
        <rect x={-q} y={-q} width={qr.size + 2 * q} height={qr.size + 2 * q} fill="#fff" />
        <path d={qr.d} fill="#14110c" />
      </svg>
    </div>
  );
}
