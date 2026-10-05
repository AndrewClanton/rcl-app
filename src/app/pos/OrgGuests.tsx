"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { withArticle } from "@/lib/email/org-invite-email";
import { GROUP_NOTE_MAX, groupInput, groupPeople, groupSummary, MAX_GROUP_PEOPLE, type CompPlan, type OrgGroupOnOrder } from "@/lib/orgs";
import { getOrgGroup, getOrgGroupChoices, inviteHelper, type OrgGroupChoices } from "./org-actions";

// "Organization guests" on the register (lib/orgs.ts): a group with no
// name, phone, email or account. A helper says "we're with Easter Seals";
// the cashier taps the organization, sets how many supported guests and
// helpers with + and −, and applies it. Each person is a comp (a day pass,
// their movies today) logged to the organization. Today's groups come back
// with one tap ("same group, later today"): no new comps, the org's pricing.

export function OrgGuestsButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`btn-secondary !py-2 text-sm font-semibold ${className}`} onClick={onClick}>
      Organization guests
    </button>
  );
}

function Counter({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(0, Math.min(MAX_GROUP_PEOPLE, n)));
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </div>
      </div>
      <button type="button" className="btn-secondary !h-14 !w-14 !p-0 text-2xl" aria-label={`One less ${label.toLowerCase()}`} onClick={() => set(value - 1)}>
        −
      </button>
      <input
        className="input !w-16 text-center !text-2xl tabular-nums"
        inputMode="numeric"
        aria-label={label}
        value={String(value)}
        onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)}
      />
      <button type="button" className="btn-secondary !h-14 !w-14 !p-0 text-2xl" aria-label={`One more ${label.toLowerCase()}`} onClick={() => set(value + 1)}>
        +
      </button>
    </div>
  );
}

// "Invite a helper": a full-screen sheet the cashier hands over on the
// register iPad. The helper types their work email and taps Send; the
// organization's sign-up link goes to it (lib/org-invite-server.ts). It
// shows only the organization's name and what was just typed, and goes
// back to an empty form a few seconds after sending.
const SENT_CLEAR_MS = 6000;

export function HelperInviteSheet({ orgId, orgName, onClose }: { orgId: string; orgName: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(false), SENT_CLEAR_MS);
    return () => clearTimeout(t);
  }, [sent]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await inviteHelper(orgId, email.trim()).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't reach the server. Try again.");
    if (!r.ok) return setError(r.error);
    setEmail("");
    setSent(true);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto p-6 sm:p-10" style={{ background: "var(--background)" }} role="dialog" aria-modal="true" aria-label={`Join ${orgName}`}>
      <div className="flex justify-end">
        <button type="button" className="btn-secondary !py-2 text-base" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 text-center">
        {sent ? (
          <div role="status" className="space-y-3">
            <div className="text-6xl" aria-hidden>
              ✉️
            </div>
            <div className="text-4xl font-bold">Sent!</div>
            <div className="text-2xl">Check your email to join {orgName}.</div>
          </div>
        ) : (
          <form className="space-y-6" onSubmit={send}>
            <div>
              <div className="text-xl" style={{ color: "var(--muted)" }}>
                Join {orgName} at Royale Cinema
              </div>
              <h2 className="text-4xl font-bold">Type your work email</h2>
            </div>
            <input
              className="input w-full !py-4 text-center !text-2xl"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@work.org"
              aria-label="Your work email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              autoFocus
            />
            {error && (
              <p className="text-lg" style={{ color: "var(--danger-text)" }} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full !py-5 text-2xl" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send"}
            </button>
            <p className="text-base" style={{ color: "var(--muted)" }}>
              We&apos;ll email you a link to join as {withArticle(orgName)} helper.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export function OrgGuestsPicker({ onApply, onClose }: { onApply: (g: OrgGroupOnOrder) => void; onClose: () => void }) {
  const [choices, setChoices] = useState<OrgGroupChoices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [supported, setSupported] = useState(1);
  const [helpers, setHelpers] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let live = true;
    getOrgGroupChoices().then(
      (c) => live && setChoices(c),
      () => live && setLoadError("Couldn't load the organizations. Try again."),
    );
    return () => {
      live = false;
    };
  }, []);

  const org = choices?.orgs.find((o) => o.id === orgId) ?? null;
  const people = supported + helpers;
  const preview: OrgGroupOnOrder | null = org
    ? { orgId: org.id, orgName: org.name, active: true, limit: org.limit, used: org.used, groupId: null, supported, helpers, note: note.trim() || null, moviesToday: {}, taxIncluded: true }
    : null;

  async function apply(g: OrgGroupOnOrder) {
    setBusy(true);
    setError(null);
    const fresh = await getOrgGroup(groupInput(g)).catch(() => null);
    setBusy(false);
    if (!fresh) return setError("Couldn't check that group with the server. Try again.");
    onApply(fresh);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Organization guests">
      <div className="card w-full max-w-xl space-y-4 shadow-2xl">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">
              Organization guests
              <InfoTip topic="organization-guests" />
            </h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No name, phone or account needed. Ask which organization they&apos;re with and how many are in the group.
            </p>
          </div>
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {loadError && (
          <p className="text-sm" style={{ color: "var(--danger-text)" }} role="alert">
            {loadError}
          </p>
        )}
        {!choices && !loadError && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>}

        {choices && choices.today.length > 0 && (
          <section className="space-y-2">
            <div className="label-xs">Same group, later today (no new comps)</div>
            {choices.today.map((g) => (
              <button
                key={g.groupId}
                type="button"
                disabled={busy}
                className="btn-secondary block w-full !py-2.5 text-left text-sm"
                onClick={() => apply(g)}
              >
                <strong>{g.orgName} group (today)</strong> · {g.supported} supported + {g.helpers} {g.helpers === 1 ? "helper" : "helpers"}
                {g.note ? <span style={{ color: "var(--muted)" }}> · {g.note}</span> : null}
              </button>
            ))}
          </section>
        )}

        {choices && (
          <section className="space-y-2">
            <div className="label-xs">New group: which organization?</div>
            {choices.orgs.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No active organizations. Make one in Back office → Organizations.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {choices.orgs.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`${o.id === orgId ? "btn-primary" : "btn-secondary"} !py-3 text-left`}
                    aria-pressed={o.id === orgId}
                    onClick={() => setOrgId(o.id)}
                  >
                    <div className="font-semibold">{o.name}</div>
                    <div className="text-xs opacity-80 tabular-nums">
                      {o.used}/{o.limit} comps today
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {org && preview && (
          <section className="space-y-3">
            <Counter label="Supported guests" hint="the people the organization brings" value={supported} onChange={setSupported} />
            <Counter label="Helpers" hint="staff with them" value={helpers} onChange={setHelpers} />
            <label className="block">
              <div className="label-xs">Note (optional)</div>
              <input className="input" maxLength={GROUP_NOTE_MAX} placeholder="red shirt, group from Carthage…" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="rounded-md border-2 px-3 py-2 text-sm font-semibold" style={{ borderColor: org.used + people > org.limit ? "var(--danger-text)" : "var(--accent)" }}>
              {people < 1 ? "Add at least one person." : groupSummary(preview)}
              {org.used + people > org.limit && people > 0 && (
                <span className="mt-1 block font-normal" style={{ color: "var(--danger-text)" }}>
                  That&apos;s over today&apos;s {org.limit}. A manager&apos;s PIN can approve it on the order.
                </span>
              )}
            </p>
            {error && (
              <p className="text-sm" style={{ color: "var(--danger-text)" }} role="alert">
                {error}
              </p>
            )}
            <button type="button" className="btn-primary w-full !py-3 text-base" disabled={busy || people < 1} onClick={() => apply(preview)}>
              {busy ? "Checking…" : `Add ${people} day ${people === 1 ? "pass" : "passes"} at $0`}
            </button>
            <button type="button" className="btn-secondary w-full !py-2.5 text-sm" onClick={() => setInviting(true)}>
              Invite a helper to join {org.name} (they type their work email)
            </button>
          </section>
        )}
      </div>
      {inviting && org && <HelperInviteSheet orgId={org.id} orgName={org.name} onClose={() => setInviting(false)} />}
    </div>
  );
}

// The group on the order: who, what it uses, the tax-included switch, and
// the manager override when today's comps run out. refreshKey: bump to
// count today's comps again (the other register may have used some).
export function OrgGroupCard({
  group,
  plan,
  onChange,
  onRemove,
  onOverride,
  refreshKey,
}: {
  group: OrgGroupOnOrder;
  plan: CompPlan;
  onChange: (g: OrgGroupOnOrder) => void;
  onRemove: () => void;
  onOverride: () => void;
  refreshKey: number;
}) {
  useEffect(() => {
    if (!refreshKey) return;
    let live = true;
    getOrgGroup(groupInput(group)).then((g) => live && g && onChange(g), () => undefined);
    return () => {
      live = false;
    };
    // Only when asked: group and onChange change with every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <div className="rounded-md border-2 px-2 py-1.5 text-xs" style={{ borderColor: plan.blocked ? "var(--danger-text)" : "var(--accent)" }} role="status">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 font-bold">
          {groupSummary(group)}
          <InfoTip topic="organization-guests" />
        </div>
        <button type="button" className="btn-secondary shrink-0 !px-2 !py-1 !text-xs" onClick={onRemove}>
          Take off
        </button>
      </div>
      <div style={{ color: "var(--muted)" }}>
        No account{group.note ? ` · ${group.note}` : ""}
        {!group.groupId && plan.amount === 0 && !plan.blocked ? ` · add ${groupPeople(group)} day passes to comp them` : ""}
      </div>
      {group.supported > 0 && (
        <label className="mt-1 flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={group.taxIncluded} onChange={(e) => onChange({ ...group, taxIncluded: e.target.checked })} />
          Tax included ({group.orgName} guest)
        </label>
      )}
      {plan.blocked && (
        <div className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 font-semibold" style={{ color: "var(--danger-text)" }}>
            Not enough comps left today ({group.used}/{group.limit}), so the day passes and tickets are charged.
          </span>
          <button type="button" className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={onOverride}>
            Manager override
          </button>
        </div>
      )}
      {plan.overLimit && <div className="mt-1 font-semibold">Over the limit: a manager approved these comps.</div>}
    </div>
  );
}
