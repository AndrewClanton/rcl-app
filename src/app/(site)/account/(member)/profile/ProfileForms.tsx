"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setEmailOptIn, updateMyProfile } from "../../actions";

export function ProfileDetailsForm({ name: initialName, phone: initialPhone }: { name: string; phone: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name !== initialName || phone !== initialPhone;

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await updateMyProfile({ name, phone }).catch(() => ({ ok: false as const, error: "Something went wrong." }));
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
        if (r.ok) router.refresh();
      }}
    >
      <label className="block">
        <div className="label-xs">Name</div>
        <input id="profile-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label className="block">
        <div className="label-xs">Phone</div>
        <input id="profile-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="(417) 555-0123" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary !px-5 !py-2 text-sm" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary !px-4 !py-2 text-sm" onClick={() => setOpen(true)}>
          {hasPassword ? "Change password" : "Set a password"}
        </button>
        {msg && <span className="text-sm text-[var(--success-text)]">{msg.text}</span>}
      </div>
    );
  }

  return (
    <form
      className="grid max-w-md gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8) return setMsg({ ok: false, text: "Use at least 8 characters." });
        if (pw !== confirm) return setMsg({ ok: false, text: "Those passwords don't match." });
        setBusy(true);
        setMsg(null);
        const { error } = await createClient().auth.updateUser({ password: pw });
        setBusy(false);
        if (error) return setMsg({ ok: false, text: error.message });
        setPw("");
        setConfirm("");
        setOpen(false);
        setMsg({ ok: true, text: hasPassword ? "Password changed." : "Password set. You can now sign in with your email too." });
      }}
    >
      <label className="block">
        <div className="label-xs">New password</div>
        <input id="new-password" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="block">
        <div className="label-xs">Type it again</div>
        <input id="confirm-password" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-primary !px-5 !py-2 text-sm" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
        <button type="button" className="text-sm text-[var(--muted)] hover:underline" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {msg && !msg.ok && <span className="text-sm text-[var(--danger-text)]">{msg.text}</span>}
      </div>
    </form>
  );
}

export function EmailPreference({ optIn }: { optIn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(optIn);
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        id="email-opt-in"
        type="checkbox"
        className="mt-1 h-4 w-4 accent-[var(--accent)]"
        checked={value}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setValue(next);
          setBusy(true);
          const r = await setEmailOptIn(next).catch(() => ({ ok: false as const, error: "" }));
          setBusy(false);
          if (!r.ok) setValue(!next);
          else router.refresh();
        }}
      />
      <span className="text-sm">
        <strong>Weekly lineup and member news</strong>
        <span className="block text-[var(--muted)]">What&apos;s playing each week, including the members-only classics. We&apos;ll still send receipts and account notices.</span>
      </span>
    </label>
  );
}
