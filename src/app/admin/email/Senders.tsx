"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmailSender } from "./actions";

// The Email page's "Who sends email to members": a tick per person
// (lib/email/senders.ts). Owners change it; everyone else sees who.

export interface SenderItem {
  id: string;
  name: string;
  role: string;
  sends: boolean;
}

const ROLE: Record<string, string> = { manager: "Manager", admin: "Admin", owner: "Owner" };

export default function Senders({ rows, canEdit }: { rows: SenderItem[] | null; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const senders = rows?.filter((r) => r.sends) ?? [];
  const flip = (r: SenderItem, on: boolean) =>
    start(async () => {
      const out = await setEmailSender(r.id, on).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      setMsg(out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error });
      router.refresh();
    });

  return (
    <section id="senders" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
      <h2 className="font-display text-xl">Who sends email to members</h2>
      <p className="mt-1 text-[var(--muted)]">
        Only the people ticked here can send an email to members, carry one on after a pause, or switch on an automation. Anyone can still look, write a draft and
        send themselves a test, and any manager can pause or stop.
      </p>
      {rows === null ? (
        <p className="mt-2 text-[var(--danger-text)]">Not set up yet: the database update for it hasn&apos;t been applied.</p>
      ) : canEdit ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={r.sends} disabled={pending} onChange={(e) => flip(r, e.target.checked)} />
                <span className="font-semibold">{r.name}</span>
                <span className="ml-auto text-xs text-[var(--muted)]">{ROLE[r.role] ?? r.role}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2">{senders.length ? senders.map((r) => r.name).join(", ") : "Nobody yet. An owner picks who."}</p>
      )}
      {canEdit && rows !== null && senders.length === 0 && <p className="mt-2 text-xs">Nobody is ticked, so nothing can be sent to members until someone is.</p>}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
    </section>
  );
}
