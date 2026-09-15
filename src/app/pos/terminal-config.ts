import "server-only";

export function terminalConfigured(): boolean {
  return !!process.env.STRIPE_TERMINAL_READER_ID;
}
