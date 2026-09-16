"use client";

import { useMemo, useState } from "react";
import type { CommunityProgram, Member, MemberPriceTier, MemberTier } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import {
  addCommunityProgram,
  addMember,
  deleteMember,
  grantFreeMembership,
  revokeFreeMembership,
  setCommunityProgramActive,
  updateMember,
} from "./actions";

export default function MemberManager({ members, communityPrograms }: { members: Member[]; communityPrograms: CommunityProgram[] }) {
  const [query, setQuery] = useState("");
  const [showCompedOnly, setShowCompedOnly] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (showCompedOnly && !m.comped) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q);
    });
  }, [members, query, showCompedOnly]);

  const compedCount = members.filter((m) => m.comped).length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[200px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="Search members by name or email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={showCompedOnly} onChange={(e) => setShowCompedOnly(e.target.checked)} />
            Community/free members only ({compedCount})
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {filtered.map((m) => (
            <MemberRow key={m.id} member={m} communityPrograms={communityPrograms} />
          ))}
          {filtered.length === 0 && <div className="py-4 text-sm text-neutral-500">No members match.</div>}
        </div>
      </div>

      <AddMemberForm />
      <CommunityProgramsPanel programs={communityPrograms} />
    </div>
  );
}

function MemberRow({ member, communityPrograms }: { member: Member; communityPrograms: CommunityProgram[] }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [points, setPoints] = useState(String(member.points));
  const [compFormOpen, setCompFormOpen] = useState(false);

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[140px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== member.name) run(() => updateMember(member.id, { name: name.trim() }));
          }}
        />
        <input
          className="min-w-[160px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => {
            if (email !== (member.email ?? "")) run(() => updateMember(member.id, { email: email.trim() || null }));
          }}
        />
        <select
          className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={member.tier}
          disabled={pending}
          onChange={(e) => run(() => updateMember(member.id, { tier: e.target.value as MemberTier }))}
        >
          <option value="Insiders">Insiders</option>
          <option value="Insiders+">Insiders+</option>
        </select>
        {member.tier === "Insiders+" && (
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={member.price_tier ?? ""}
            disabled={pending}
            title="Price tier -- set to 'student' for an in-person counter upgrade (not sold online)"
            onChange={(e) => run(() => updateMember(member.id, { price_tier: (e.target.value || null) as MemberPriceTier | null }))}
          >
            <option value="">Price tier...</option>
            <option value="adult">Adult ($15/mo)</option>
            <option value="senior">Senior ($12/mo)</option>
            <option value="student">Student ($10/mo, in-person)</option>
          </select>
        )}
        {member.stripe_subscription_id && (
          <span className="text-xs text-neutral-500" title="Managed by Stripe -- syncs automatically on renewal/cancellation">
            Stripe: {member.subscription_status}
          </span>
        )}
        <input
          type="number"
          className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          onBlur={() => {
            const v = parseFloat(points);
            if (!isNaN(v) && v !== member.points) run(() => updateMember(member.id, { points: v }));
          }}
        />
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={member.monthly_member}
            disabled={pending}
            onChange={(e) => run(() => updateMember(member.id, { monthly_member: e.target.checked }))}
          />
          Monthly
        </label>
        <button
          className="ml-auto rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900"
          disabled={pending}
          onClick={() => {
            if (confirm(`Remove member "${member.name}"?`)) run(() => deleteMember(member.id));
          }}
        >
          Remove
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {member.comped ? (
          <>
            <span
              className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
              title={member.comp_notes ?? undefined}
            >
              Free membership · {member.community_program?.name ?? "Community program"}
            </span>
            <button
              className="text-xs text-neutral-500 hover:underline"
              disabled={pending}
              onClick={() => {
                if (confirm(`Remove free-membership status from "${member.name}"?`)) run(() => revokeFreeMembership(member.id));
              }}
            >
              Revoke
            </button>
          </>
        ) : (
          <button className="text-xs text-neutral-500 hover:underline" onClick={() => setCompFormOpen((v) => !v)}>
            Grant free membership...
          </button>
        )}
      </div>

      {compFormOpen && !member.comped && (
        <GrantCompForm
          communityPrograms={communityPrograms}
          pending={pending}
          onCancel={() => setCompFormOpen(false)}
          onSubmit={(fields) => {
            run(() => grantFreeMembership(member.id, fields));
            setCompFormOpen(false);
          }}
        />
      )}
    </div>
  );
}

function GrantCompForm({
  communityPrograms,
  pending,
  onCancel,
  onSubmit,
}: {
  communityPrograms: CommunityProgram[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fields: { communityProgramId: string | null; notes: string }) => void;
}) {
  const [programId, setProgramId] = useState("");
  const [notes, setNotes] = useState("");
  const activePrograms = communityPrograms.filter((p) => p.active);

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs text-neutral-500">Community program</label>
          <select
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
          >
            <option value="">None specified</option>
            {activePrograms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-[2] min-w-[220px]">
          <label className="mb-1 block text-xs text-neutral-500">Notes (optional)</label>
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. referred by St. Mary's food pantry"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending}
          onClick={() => onSubmit({ communityProgramId: programId || null, notes })}
        >
          Grant Insiders+ free
        </button>
        <button className="text-xs text-neutral-500 hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddMemberForm() {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<MemberTier>("Insiders");

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-3 text-lg font-semibold">Add member</h2>
      <div className="flex flex-wrap items-end gap-2">
        <input
          className="min-w-[160px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="min-w-[160px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Email (optional)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={tier}
          onChange={(e) => setTier(e.target.value as MemberTier)}
        >
          <option value="Insiders">Insiders</option>
          <option value="Insiders+">Insiders+</option>
        </select>
        <button
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !name.trim()}
          onClick={() => {
            const fields = { name, email, tier };
            setName("");
            setEmail("");
            run(() => addMember(fields));
          }}
        >
          Add member
        </button>
      </div>
    </div>
  );
}

function CommunityProgramsPanel({ programs }: { programs: CommunityProgram[] }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-1 text-lg font-semibold">Community programs</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Social/outreach programs that grant free Insiders+ membership. Used to tag comped members for nonprofit reporting -- see the
        Reports page for participation counts.
      </p>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {programs.map((p) => (
          <div key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className={p.active ? "" : "text-neutral-400 line-through"}>{p.name}</span>
            {p.description && <span className="text-xs text-neutral-500">— {p.description}</span>}
            <button
              className="ml-auto text-xs text-neutral-500 hover:underline"
              disabled={pending}
              onClick={() => run(() => setCommunityProgramActive(p.id, !p.active))}
            >
              {p.active ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        ))}
        {programs.length === 0 && <div className="py-2 text-sm text-neutral-500">No community programs yet.</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input
          className="min-w-[160px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Program name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="min-w-[200px] flex-[2] rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !name.trim()}
          onClick={() => {
            const fields = { name, description };
            setName("");
            setDescription("");
            run(() => addCommunityProgram(fields));
          }}
        >
          Add program
        </button>
      </div>
    </div>
  );
}
