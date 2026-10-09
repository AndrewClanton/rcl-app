"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BirthdayPicker from "@/components/BirthdayPicker";
import { badgeFor, birthdayFromInput } from "@/lib/visits";
import { updateMyProfile } from "../../actions";
import { PROFILE_LINE_MAX } from "@/lib/member-profile";

// birthday is "12-30" or "" (see BirthdayPicker).
export function ProfileDetailsForm({
  name: initialName,
  phone: initialPhone,
  tagline: initialTagline,
  birthday: initialBirthday,
  lineHidden = false,
}: {
  name: string;
  phone: string;
  tagline: string;
  birthday: string;
  // Staff hid their profile line: it shows nowhere until they show it again.
  lineHidden?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [tagline, setTagline] = useState(initialTagline);
  const [birthday, setBirthday] = useState(initialBirthday);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name !== initialName || phone !== initialPhone || tagline !== initialTagline || birthday !== initialBirthday;

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (birthdayFromInput(birthday) === undefined) return setMsg({ ok: false, text: "Pick both the month and the day of your birthday (or neither)." });
        setBusy(true);
        setMsg(null);
        const r = await updateMyProfile({ name, phone, tagline, birthday }).catch(() => ({ ok: false as const, error: "Something went wrong." }));
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
      <div className="block sm:col-span-2">
        <label className="label-xs" htmlFor="profile-birthday">
          Birthday (optional)
        </label>
        <div className="sm:max-w-sm">
          <BirthdayPicker id="profile-birthday" className="input" value={birthday} onChange={setBirthday} />
        </div>
        <div className="mt-1 text-xs text-[var(--muted)]">
          Check in during your birthday week for {badgeFor("birthday")?.points} bonus points. Just the month and day; no year.
        </div>
      </div>
      <label className="block sm:col-span-2">
        <div className="label-xs">Profile line (optional)</div>
        <input
          id="profile-tagline"
          className="input"
          value={tagline}
          maxLength={PROFILE_LINE_MAX}
          onChange={(e) => setTagline(e.target.value)}
          placeholder={'A favorite movie quote, a signature, "Horror or nothing"'}
        />
        <div className="mt-1 text-xs text-[var(--muted)]">
          Just for fun: it shows on your profile page if you share it, and on the check-in screen when you check in. {tagline.length}/{PROFILE_LINE_MAX}
        </div>
        {lineHidden && (
          <div className="mt-1 text-xs font-bold text-[var(--danger-text)]">
            Hidden by our staff, so it isn&apos;t showing anywhere right now. Questions? Email info@royalecinemajoplin.com.
          </div>
        )}
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary min-h-11 !px-5 !py-2 text-sm" disabled={busy || !dirty}>
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
        <button type="button" className="btn-secondary min-h-11 !px-4 !py-2 text-sm" onClick={() => setOpen(true)}>
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
        <button className="btn-primary min-h-11 !px-5 !py-2 text-sm" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
        <button type="button" className="min-h-11 px-2 text-sm text-[var(--muted)] hover:underline" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {msg && !msg.ok && <span className="text-sm text-[var(--danger-text)]">{msg.text}</span>}
      </div>
    </form>
  );
}
