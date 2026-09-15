import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Employee PINs are short (4 digits) but still hashed rather than stored
// in plaintext, since employees.pin_hash also gates manager-approval
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
