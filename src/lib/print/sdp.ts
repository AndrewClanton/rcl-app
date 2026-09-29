// Epson Server Direct Print, the wire format (Epson's "Server Direct Print
// User's Manual", chapter 3). The printer (or the Pi relay) POSTs form data
// to /api/print/poll:
//
//   ConnectionType=GetRequest&ID=<its ID>&Name=<its name>
//     -> we answer with a <PrintRequestInfo Version="2.00"> wrapping one
//        <ePOSPrint> per job, each with a printjobid, or an empty body when
//        there's nothing to print.
//   ConnectionType=SetResponse&ID=...&ResponseFile=<PrintResponseInfo>
//     -> how each printjobid went; we answer with an empty body.
//   ConnectionType=SetStatus&ID=...&Status=... (Status Notification, if
//     it's turned on) -> an empty body.
//
// Pure string work, so node can test it (scripts/check-print-queue.mjs).

export const SDP_DEVID = "local_printer";

// Job ids go out as 22 characters (the uuid's 16 bytes, base64url): short,
// and only letters, digits, "-" and "_", which is all the printer's own ID
// fields allow.
export function toPrintJobId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

export function fromPrintJobId(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const hex = Buffer.from(id, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The answer to a GetRequest. The job XML goes in as-is: it's the same
// ePOS-Print document the register used to post to the printer directly.
export function printRequestXml(jobs: { id: string; xml: string }[]): string {
  const parts = jobs.map(
    (j) =>
      `<ePOSPrint><Parameter><devid>${SDP_DEVID}</devid><timeout>20000</timeout><printjobid>${toPrintJobId(j.id)}</printjobid></Parameter><PrintData>${j.xml}</PrintData></ePOSPrint>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n<PrintRequestInfo Version="2.00">${parts.join("")}</PrintRequestInfo>`;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3] ?? "") : null;
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export interface PrintResult {
  jobId: string | null; // our uuid, when the printer said which job
  ok: boolean;
  code: string; // the printer's code, "" on success
}

export interface ParsedResponse {
  results: PrintResult[];
  // PrintRequestInfo 3.00 printers can reject the whole answer (bad XML,
  // too big) before printing anything.
  envelopeError: string | null;
}

// A SetResponse's ResponseFile. Version 2.00 names each job
// (<ePOSPrint><Parameter><printjobid>); 1.00 only lists <response>s in order.
export function parseResponseFile(xml: string): ParsedResponse {
  const results: PrintResult[] = [];
  let envelopeError: string | null = null;

  const sdp = xml.match(/<ServerDirectPrint>[\s\S]*?<Response\b([^>]*)>([\s\S]*?)<\/ServerDirectPrint>/i);
  if (sdp && (attr(sdp[1], "Success") ?? "").toLowerCase() === "false") {
    const summary = sdp[2].match(/<ErrorSummary>([\s\S]*?)<\/ErrorSummary>/i)?.[1] ?? "";
    const detail = sdp[2].match(/<ErrorDetail>([\s\S]*?)<\/ErrorDetail>/i)?.[1] ?? "";
    envelopeError = unescapeXml([summary, detail].filter(Boolean).join(": ")).slice(0, 200) || "The printer rejected the print data";
  }

  const blocks = [...xml.matchAll(/<ePOSPrint>([\s\S]*?)<\/ePOSPrint>/gi)];
  if (blocks.length) {
    for (const b of blocks) {
      const raw = b[1].match(/<printjobid>([\s\S]*?)<\/printjobid>/i)?.[1]?.trim() ?? "";
      const tag = b[1].match(/<response\b[^>]*>/i)?.[0] ?? "";
      results.push({ jobId: fromPrintJobId(raw), ok: (attr(tag, "success") ?? "").toLowerCase() === "true", code: attr(tag, "code") ?? "" });
    }
  } else {
    for (const m of xml.matchAll(/<response\b[^>]*>/gi)) {
      results.push({ jobId: null, ok: (attr(m[0], "success") ?? "").toLowerCase() === "true", code: attr(m[0], "code") ?? "" });
    }
  }
  return { results, envelopeError };
}

// The form body. With "URL Encode" on (recommended) it's ordinary form
// data; with it off, the ResponseFile XML arrives raw and may itself hold
// "&", so it's cut out by hand: it's the last field, and runs to the XML's
// closing ">".
export function parseSdpForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const at = body.indexOf("ResponseFile=");
  const head = at >= 0 ? body.slice(0, at) : body;
  for (const [k, v] of new URLSearchParams(head)) out[k] = v;
  if (at >= 0) {
    const rest = body.slice(at + "ResponseFile=".length);
    if (rest.includes("<")) out.ResponseFile = rest.slice(0, rest.lastIndexOf(">") + 1);
    else {
      const params = new URLSearchParams(`ResponseFile=${rest}`);
      out.ResponseFile = params.get("ResponseFile") ?? "";
      for (const [k, v] of params) if (k !== "ResponseFile") out[k] = v;
    }
  }
  return out;
}
