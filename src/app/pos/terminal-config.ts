import "server-only";

// A register device picks its own card reader under Devices. This optional
// env var is only a fallback for a device that hasn't picked one yet.
export function defaultReaderId(): string | null {
  return process.env.STRIPE_TERMINAL_READER_ID || null;
}
