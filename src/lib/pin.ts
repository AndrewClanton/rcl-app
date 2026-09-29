import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DEFAULT_PIN } from "@/lib/pin-rules";

// Employee PINs are short (4 to 6 digits) but still hashed rather than
// stored in plaintext, since employees.pin_hash also gates manager-approval
// actions (refunds, voids). Format: scrypt$<salt-hex>$<hash-hex>.
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(pin, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// "9999" hashed with a fixed salt -- what every account provisioned through
// the Staff page, scripts/create-admin-user.mjs and supabase/seed.sql has
// always started with. Kept so a new account works on the register the
// moment it's made; the back office then asks them to pick their own.
export const DEFAULT_PIN_HASH = "scrypt$726376705f736565645f73616c74$1e51f61dd18946a3fda261fc467d6c44b2af95f7abec1d2b237d14a27733d09f";

// Still on 9999? The string check skips the hashing for the common case
// (the shared hash above); verifyPin catches a 9999 hashed any other way.
export function isDefaultPin(stored: string): boolean {
  return stored === DEFAULT_PIN_HASH || verifyPin(DEFAULT_PIN, stored);
}
