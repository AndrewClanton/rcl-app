"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patternXml } from "@/lib/print/pattern-render";
import { PATTERN_DESIGNS, sampleReceipt, type PatternSettings } from "@/lib/print/receipt-patterns";
import { printPatternSamples, saveReceiptPatterns } from "./actions";

// Back office → Printers → Patterned receipts: printed customer receipts get
// one of the designs ticked here, at random, so guests get a surprise. Paper
// only; emailed and account receipts don't change. All off: plain receipts.
export default function PatternReceipts({ initial }: { initial: PatternSettings }) {
  const router = useRouter();
  const [s, setS] = useState<PatternSettings>(initial);
  const [busy, setBusy] = useState<"save" | "sample" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const anyOn = s.on && PATTERN_DESIGNS.some((d) => s.designs[d.key]);

  async function save() {
    setBusy("save");
    setNote(null);
    const r = await saveReceiptPatterns(s).catch(() => ({ ok: false as const, error: "Couldn't reach the website. Try again." }));
    setBusy(null);
    setNote(r.ok ? { ok: true, text: "Saved. Registers pick it up within a few minutes." } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  async function samples() {
    setBusy("sample");
    setNote(null);
    try {
      const xmls: string[] = [];
      for (const d of PATTERN_DESIGNS) xmls.push(await patternXml(d.key, sampleReceipt(d.key)));
      const r = await printPatternSamples(xmls);
      setNote(r.ok ? { ok: true, text: "Three samples sent to the Bar printer." } : { ok: false, text: r.error });
    } catch {
      setNote({ ok: false, text: "This browser couldn't draw the samples. Try again on the register iPad." });
    }
    setBusy(null);
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">Patterned receipts</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Printed customer receipts come out on one of the designs ticked below, picked at random each time. Emailed and online receipts don&apos;t change. If a
        register can&apos;t draw one quickly, it prints the plain receipt instead.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={s.on} onChange={(e) => setS({ ...s, on: e.target.checked })} />
        Patterned receipts
      </label>
      <div className="mt-2 space-y-1.5 pl-6">
        {PATTERN_DESIGNS.map((d) => (
          <label key={d.key} className={`flex items-start gap-2 text-sm ${s.on ? "" : "opacity-50"}`}>
            <input type="checkbox" className="mt-1" disabled={!s.on} checked={s.designs[d.key]} onChange={(e) => setS({ ...s, designs: { ...s.designs, [d.key]: e.target.checked } })} />
            <span>
              {d.label}
              <span className="block text-xs text-[var(--muted)]">{d.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {!anyOn && <p className="mt-2 text-xs text-[var(--muted)]">With none ticked, receipts print plain.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary !px-4 !py-1.5 text-sm" disabled={!dirty || !!busy} onClick={save}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" disabled={!!busy} onClick={samples}>
          {busy === "sample" ? "Sending…" : "Print a sample of each"}
        </button>
      </div>
      {note && <div className={`notice ${note.ok ? "notice-success" : "notice-warn"} mt-3 text-sm`}>{note.text}</div>}
    </section>
  );
}
