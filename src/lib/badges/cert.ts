// A badge copy's certificate: the issuer's Ed25519 signature over a
// canonical JSON of what makes the copy itself. Anyone with the issuer's
// public key (badge_issuers.public_key) can check it, and the verify page
// (/b/[code]) does. The private key is BADGE_SIGNING_KEY (PKCS8 DER, base64),
// which only the server has.
//
// The certificate covers: the copy's id, its badge definition, series and
// serial, its holder and issuer, when it was minted, the hash of its art,
// its face (name and flavor), its stats and the event it was for. Version 1;
// a change to what's covered is a new cert_version, and old copies keep
// verifying as version 1.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const CERT_VERSION = 1;

export interface CertFields {
  copyId: string;
  defId: string;
  series: number;
  serial: number;
  holderId: string;
  issuerId: string;
  mintedAt: string; // any form Date can read; signed as ISO with milliseconds
  artHash: string;
  name: string;
  flavor: string;
  stats: Record<string, unknown>;
  event: { kind: string | null; ref: string | null; label: string | null };
}

// JSON with every object's keys in order, so the same certificate is always
// the same bytes.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function certPayload(f: CertFields): string {
  return canonicalJson({
    v: CERT_VERSION,
    copy_id: f.copyId,
    def_id: f.defId,
    series: f.series,
    serial: f.serial,
    holder_id: f.holderId,
    issuer_id: f.issuerId,
    minted_at: new Date(f.mintedAt).toISOString(),
    art_hash: f.artHash,
    name: f.name,
    flavor: f.flavor,
    stats: f.stats ?? {},
    event: { kind: f.event.kind ?? null, ref: f.event.ref ?? null, label: f.event.label ?? null },
  });
}

export function artHash(svg: string): string {
  return createHash("sha256").update(svg, "utf8").digest("hex");
}

export function signCert(f: CertFields, privateKeyB64: string): string {
  const key = createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(certPayload(f), "utf8"), key).toString("base64");
}

export function verifyCert(f: CertFields, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(certPayload(f), "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// The public half of a private key, as stored in badge_issuers.public_key.
export function publicKeyFor(privateKeyB64: string): string {
  const priv = createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  return createPublicKey(priv).export({ format: "der", type: "spki" }).toString("base64");
}
