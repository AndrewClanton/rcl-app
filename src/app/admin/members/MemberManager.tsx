"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommunityProgram, Member, MemberTier } from "@/lib/types";
import type { MembersPage } from "@/lib/data/members";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addCommunityProgram, addMember, setCommunityProgramActive } from "./actions";

function tierBadgeClass(tier: MemberTier) {
  return tier === "Insiders+"
    ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
    : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400";
}

export default function MemberManager({
  membersPage,
  communityPrograms,
  query,
  compedOnly,
}: {
  membersPage: MembersPage;
  communityPrograms: CommunityProgram[];
  query: string;
  compedOnly: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const firstRender = useRef(true);

  // Debounced, URL-driven search -- keeps the query (and pagination) at
  // the server so we're never pulling all ~3,000 members into the browser
  // just to filter them client-side.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (compedOnly) params.set("comped", "1");
      router.push(`/admin/members?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleCompedOnly(checked: boolean) {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (checked) params.set("comped", "1");
    router.push(`/admin/members?${params.toString()}`);
  }

  function goToPage(page: number) {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (compedOnly) params.set("comped", "1");
    params.set("page", String(page));
    router.push(`/admin/members?${params.toString()}`);
  }

  const { members, total, page, pageSize } = membersPage;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[200px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="Search members by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={compedOnly} onChange={(e) => toggleCompedOnly(e.target.checked)} />
            Community/free members only
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((m) => (
            <Link
              key={m.id}
              href={`/admin/members/${m.id}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <span className="min-w-[160px] flex-1 font-medium">{m.name}</span>
              <span className="min-w-[160px] flex-1 truncate text-neutral-500">{m.email ?? "—"}</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${tierBadgeClass(m.tier)}`}>{m.tier}</span>
              {m.comped && (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
                  Free · {m.community_program?.name ?? "community"}
                </span>
              )}
              <span className="text-xs text-neutral-500">{m.points} pts</span>
              <span className="ml-auto text-xs text-neutral-400">→</span>
            </Link>
          ))}
          {members.length === 0 && <div className="px-4 py-6 text-sm text-neutral-500">No members match.</div>}
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500 dark:border-neutral-800">
            <span>
              Showing {from}–{to} of {total}
            </span>
            <div className="flex gap-2">
              <button
                className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <AddMemberForm />
      <CommunityProgramsPanel programs={communityPrograms} />
    </div>
  );
}

function AddMemberForm() {
  const [pending, run] = useRefreshingAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<MemberTier>("Insiders");

  if (!open) {
    return (
      <button
        className="rounded-xl border border-dashed border-neutral-300 bg-white px-5 py-3 text-sm text-neutral-500 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950"
        onClick={() => setOpen(true)}
      >
        + Add member
      </button>
    );
  }

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
            setOpen(false);
            run(() => addMember(fields));
          }}
        >
          Add member
        </button>
        <button className="text-sm text-neutral-500 hover:underline" onClick={() => setOpen(false)}>
          Cancel
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
        Social/outreach programs that grant free Insiders+ membership. Grant one from a member&apos;s page -- counts show up on the Reports
        page for nonprofit reporting.
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
