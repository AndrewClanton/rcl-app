// What an Epson printer's error codes mean for whoever is at the register.
// The same codes come back whether a job went straight to the printer
// (epos-client.ts) or through the print queue (Server Direct Print, or the
// Pi relay for the old TM-m30).
const CODE_MESSAGES: Record<string, string> = {
  EPTR_COVER_OPEN: "The printer's cover is open. Close it and try again.",
  EPTR_REC_EMPTY: "The printer is out of paper.",
  EPTR_AUTOMATICAL: "The printer's cutter is jammed or it has an error. Turn it off and on.",
  EPTR_CUTTER: "The printer's cutter is jammed. Clear it, then turn the printer off and on.",
  EPTR_MECHANICAL: "The printer has a mechanical error. Turn it off and on.",
  EPTR_UNRECOVERABLE: "The printer has an error. Turn it off and on.",
  EX_TIMEOUT: "The printer didn't answer in time. Check that it's on.",
  EX_BADPORT: "The printer isn't connected or is turned off.",
  EX_SPOOLER: "The printer's queue is full. Try again in a moment.",
  DeviceNotFound: "The printer's web service is off. It needs ePOS-Print turned on in its settings.",
  EX_ENPC_TIMEOUT: "The printer is busy. Try again in a moment.",
  SchemaError: "The printer couldn't read this print job.",
  PrintSystemError: "The printer's print system had an error. Turn it off and on.",
  RELAY_UNREACHABLE: "The Pi relay couldn't reach the printer. Check that the printer is on and plugged into the network.",
};

export function printerErrorMessage(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  return CODE_MESSAGES[c] ?? `The printer couldn't print${c ? ` (${c})` : ""}.`;
}

// Errors that won't go away by trying the same job again.
export function isPermanentPrinterError(code: string | null | undefined): boolean {
  return code === "SchemaError";
}
