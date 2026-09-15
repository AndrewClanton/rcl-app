"use client";

import { useMemo, useState } from "react";
import type { Member, MemberTier } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addMember, updateMember, deleteMember } from "./actions";

export default function MemberManager({ members }: { members: Member[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [members, query]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <input
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Search members by name or email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {filtered.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
          {filtered.length === 0 && <div className="py-4 text-sm text-neutral-500">No members match.</div>}
        </div>
      </div>

      <AddMemberForm />
    </div>
  );
}

function MemberRow({ member }: { member: Member }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [points, setPoints] = useState(String(member.points));

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
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
