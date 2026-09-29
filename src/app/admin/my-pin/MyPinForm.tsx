"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pinProblem } from "@/lib/pin-rules";
import { setMyPin } from "./actions";

function PinInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label-xs block">
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        className="input text-lg tracking-[0.5em]"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );
}

export default function MyPinForm({ needsCurrent }: { needsCurrent: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Say what's wrong with the new PIN before they bother typing it twice.
  const nextProblem = next.length >= 4 ? pinProblem(next) : null;
  const ready = (!needsCurrent || current.length >= 4) && next.length >= 4 && !nextProblem && confirm.length >= 4;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await setMyPin({ current, next, confirm }).catch(() => ({ ok: false as const, error: "Couldn't save your PIN. Check the connection and try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCurrent("");
    setNext("");
    setConfirm("");
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card space-y-3">
      {needsCurrent && <PinInput id="pin-current" label="Current PIN" value={current} onChange={setCurrent} />}
      <PinInput id="pin-next" label="New PIN (4 to 6 digits)" value={next} onChange={setNext} />
      {nextProblem && <p className="text-xs text-[var(--danger-text)]">{nextProblem}</p>}
      <PinInput id="pin-confirm" label="New PIN again" value={confirm} onChange={setConfirm} />
      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      {saved && <div className="notice notice-success !p-3 text-sm">Saved. From now on, use your new PIN.</div>}
      <button type="submit" className="btn-primary" disabled={!ready || busy}>
        {busy ? "Saving…" : "Save my PIN"}
      </button>
    </form>
  );
}
