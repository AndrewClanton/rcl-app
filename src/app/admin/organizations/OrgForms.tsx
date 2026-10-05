"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ORG_ROLES, roleLabel, type OrgRole } from "@/lib/orgs";
import {
  createOrganization,
  emailInviteLink,
  findPeople,
  newInviteLink,
  organizationFromLabel,
  setPerson,
  startBilling,
  stopBilling,
  updateOrganization,
  type OrgFields,
} from "./actions";

// Back office → Organizations' forms and buttons (lib/orgs.ts).

function Problem({ error }: { error: string | null }) {
  return error ? (
    <p className="notice notice-warn text-sm" role="alert">
      {error}
    </p>
  ) : null;
}

export function OrgEditor({ id, initial }: { id: string | null; initial: OrgFields }) {
  const router = useRouter();
  const [f, setF] = useState<OrgFields>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof OrgFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setF({ ...f, [k]: e.target.value });
  };
  function save() {
    setError(null);
    start(async () => {
      const r = id ? await updateOrganization(id, f) : await createOrganization(f);
      if (!r.ok) return setError(r.error);
      if (!id && "id" in r) return router.push(`/admin/organizations/${r.id}`);
      setSaved(true);
      router.refresh();
    });
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold">Name</span>
          <input className="input mt-1 w-full" value={f.name} onChange={set("name")} placeholder="Easter Seals" maxLength={80} />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Status</span>
          <select className="input mt-1 w-full" value={f.status} onChange={set("status")}>
            <option value="active">Active: comps and tax-included prices</option>
            <option value="paused">Paused: no comps for now</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Contact name</span>
          <input className="input mt-1 w-full" value={f.contactName} onChange={set("contactName")} maxLength={120} />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Contact email</span>
          <input className="input mt-1 w-full" type="email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="Where the monthly invoice goes" />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Monthly fee ($)</span>
          <input className="input mt-1 w-full" inputMode="decimal" value={String(f.monthlyFee)} onChange={set("monthlyFee")} />
        </label>
        <label className="block text-sm">
          <span className="font-semibold">Comps a day</span>
          <input className="input mt-1 w-full" inputMode="numeric" value={String(f.dailyCompLimit)} onChange={set("dailyCompLimit")} />
          <span className="mt-1 block text-xs text-[var(--muted)]">One comp is one person&apos;s day pass. 20 = 10 pairs of a guest and a helper.</span>
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-semibold">Notes (staff only)</span>
        <textarea className="input mt-1 w-full" rows={2} value={f.notes} onChange={set("notes")} maxLength={2000} />
      </label>
      <Problem error={error} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending} onClick={save}>
          {id ? "Save" : "Make organization"}
        </button>
        {saved && <span className="text-sm text-[var(--muted)]">Saved.</span>}
      </div>
    </div>
  );
}

export function LabelToOrg({ label, people, exists }: { label: string; people: number; exists: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <strong>{label}</strong> · {people} {people === 1 ? "person" : "people"} tagged
      </span>
      <button
        className="btn-secondary !py-1.5 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await organizationFromLabel(label);
            if (!r.ok) return setError(r.error);
            router.push(`/admin/organizations/${r.id}`);
          })
        }
      >
        {exists ? `Attach ${people === 1 ? "them" : `all ${people}`}` : `Make organization and attach ${people === 1 ? "them" : `all ${people}`}`}
      </button>
      {error && <span className="w-full text-sm text-[var(--danger-text)]">{error}</span>}
    </div>
  );
}

export function PersonRow({ orgId, person }: { orgId: string; person: { id: string; name: string; contact: string | null; role: OrgRole; hasLogin: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (role: OrgRole | null) =>
    start(async () => {
      setError(null);
      const r = await setPerson(orgId, person.id, role);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <a href={`/admin/members/${person.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
        {person.name}
        <span className="ml-2 text-xs font-normal text-[var(--muted)]">
          {person.contact ?? "no contact"}
          {person.hasLogin ? "" : " · no login"}
        </span>
      </a>
      <select className="input !w-auto !py-1 text-sm" value={person.role} disabled={pending} onChange={(e) => run(e.target.value as OrgRole)} aria-label={`${person.name}'s role`}>
        {ORG_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button className="btn-secondary !py-1 text-sm" disabled={pending} onClick={() => run(null)}>
        Remove
      </button>
      {error && <span className="w-full text-sm text-[var(--danger-text)]">{error}</span>}
    </li>
  );
}

export function AttachPerson({ orgId, id, name, role = "supported" }: { orgId: string; id: string; name: string; role?: OrgRole }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-secondary !py-1 text-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setPerson(orgId, id, role);
          if (r.ok) router.refresh();
          else alert(r.error);
        })
      }
    >
      Attach {name} as {roleLabel(role).toLowerCase()}
    </button>
  );
}

export function AddPerson({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<OrgRole>("supported");
  const [found, setFound] = useState<Awaited<ReturnType<typeof findPeople>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start(async () => setFound(await findPeople(q)))}
          placeholder="Find by name, email or phone"
          aria-label="Find a member"
        />
        <select className="input !w-auto" value={role} onChange={(e) => setRole(e.target.value as OrgRole)} aria-label="Role">
          {ORG_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <button className="btn-secondary" disabled={pending || q.trim().length < 2} onClick={() => start(async () => setFound(await findPeople(q)))}>
          Find
        </button>
      </div>
      {found && found.length === 0 && <p className="text-sm text-[var(--muted)]">Nobody found. A supported guest with no account can get a phone account at the register first.</p>}
      {found && found.length > 0 && (
        <ul className="divide-y divide-[var(--border)]">
          {found.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {p.name} <span className="text-[var(--muted)]">{p.contact ?? ""}</span>
              </span>
              {p.orgId === orgId ? (
                <span className="text-[var(--muted)]">Already in</span>
              ) : (
                <button
                  className="btn-secondary !py-1 text-sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await setPerson(orgId, p.id, role);
                      if (!r.ok) return setError(r.error);
                      setFound(null);
                      setQ("");
                      router.refresh();
                    })
                  }
                >
                  Add as {roleLabel(role).toLowerCase()}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Problem error={error} />
    </div>
  );
}

export function InviteLink({ orgId, url }: { orgId: string; url: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
        <button
          className="btn-secondary"
          onClick={() =>
            navigator.clipboard?.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() => {
            if (confirm("Make a new link? The old one stops working.")) start(async () => void ((await newInviteLink(orgId)).ok && router.refresh()));
          }}
        >
          New link
        </button>
      </div>
    </div>
  );
}

// "Email the helper link": one address, Send. Logged on the page.
export function EmailInvite({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function send(e: React.FormEvent) {
    e.preventDefault();
    const to = email.trim();
    if (!to) return;
    setError(null);
    setSent(null);
    start(async () => {
      const r = await emailInviteLink(orgId, to);
      if (!r.ok) return setError(r.error);
      setSent(to);
      setEmail("");
      router.refresh();
    });
  }
  return (
    <form className="space-y-2" onSubmit={send}>
      <div className="label-xs">Email the helper link</div>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="helper@workplace.org"
          aria-label="Helper's email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSent(null);
          }}
        />
        <button type="submit" className="btn-primary" disabled={pending || !email.trim()}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {sent && (
        <p className="notice notice-success text-sm" role="status">
          Sent to {sent}: &quot;You&apos;re invited to join {orgName} at the Royale.&quot;
        </p>
      )}
      <Problem error={error} />
    </form>
  );
}

export function BillingButtons({ orgId, on }: { orgId: string; on: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <button
        className={on ? "btn-secondary" : "btn-primary"}
        disabled={pending}
        onClick={() => {
          const ask = on ? "Stop monthly billing? Stripe cancels the subscription now; nothing already invoiced is refunded." : "Start monthly billing? Stripe emails the first invoice to the contact email now.";
          if (!confirm(ask)) return;
          start(async () => {
            setError(null);
            const r = on ? await stopBilling(orgId) : await startBilling(orgId);
            if (!r.ok) return setError(r.error);
            router.refresh();
          });
        }}
      >
        {on ? "Stop monthly billing" : "Start monthly billing"}
      </button>
      <Problem error={error} />
    </div>
  );
}
