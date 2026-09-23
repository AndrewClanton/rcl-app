"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { LegacyAccount, LegacyGroup, LegacySummary } from "@/lib/data/legacy";
import { importApprovedLegacyAccounts, setLegacyDecision } from "./actions";

const GROUP_INFO: Record<LegacyGroup, { label: string; hint: string }> = {
  review: { label: "Needs review", hint: "Unclear or conflicting signals. Import or skip each one." },
  paying: { label: "Paying / Plus", hint: "Had a subscription, a Plus flag, or a paid plan on the old site. Their invite will say \"your Insiders+ is moving\"." },
  likely_real: { label: "Likely real", hint: "Real-looking names, mostly with 417 or nearby phone numbers." },
  bot: { label: "Bots", hint: "Random-string names with random out-of-area numbers. Pages are in random order -- spot-check a few for anyone real." },
};
const ORDER: LegacyGroup[] = ["review", "paying", "likely_real", "bot"];

function joined(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "—";
}

function oldPlan(r: LegacyAccount) {
  const parts = [r.membership_type, r.membership_duration && r.membership_duration !== "free" ? r.membership_duration : null, r.membership_is_plus ? "Plus" : null].filter(Boolean);
  if (r.subscription_billing_status) parts.push(`sub: ${r.subscription_billing_status}`);
  return parts.join(" · ") || "—";
}

export default function OldSiteReview({
  summary,
  group,
  query,
  page,
  pageSize,
}: {
  summary: LegacySummary;
  group: LegacyGroup;
  query: string;
  page: { rows: LegacyAccount[]; total: number; page: number };
  pageSize: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams({ group });
      if (search.trim()) params.set("q", search.trim());
      router.push(`/admin/members/old-site?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(page.total / pageSize));
  const href = (g: LegacyGroup, p = 1) => {
    const params = new URLSearchParams({ group: g });
    if (g === group && search.trim()) params.set("q", search.trim());
    if (p > 1) params.set("page", String(p));
    return `/admin/members/old-site?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/members" className="text-sm text-[var(--muted)] hover:underline">
          ← Members
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Old site members</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          Every account from royalecinemajoplin.com, sorted automatically. Most are spam-bot signups (many using strangers&apos; real email
          addresses), so only approved accounts get copied into Members, and only those will ever be emailed. Importing doesn&apos;t send
          anything or create logins.
        </p>
      </div>

      <ImportPanel summary={summary} />

      <div className="flex flex-wrap gap-2">
        {ORDER.map((g) => (
          <Link
            key={g}
            href={href(g)}
            className={`rounded-full border px-3 py-1 text-sm ${g === group ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`}
          >
            {GROUP_INFO[g].label} <span className="opacity-70">{summary.groups[g].toLocaleString()}</span>
            {g === "review" && summary.awaitingReview > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-white">{summary.awaitingReview} left</span>
            )}
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">{GROUP_INFO[group].hint}</p>
          <input
            className="min-w-[220px] rounded border border-[var(--border)] px-2 py-1 text-sm"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="divide-y divide-[var(--border)]">
          {page.rows.map((r) => (
            <Row key={r.legacy_user_id} row={r} />
          ))}
          {page.rows.length === 0 && <div className="px-4 py-6 text-sm text-[var(--muted)]">Nothing here{query ? " matches that search" : ""}.</div>}
        </div>

        {page.total > pageSize && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
            <span>
              {((page.page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page.total, page.page * pageSize).toLocaleString()} of{" "}
              {page.total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              {page.page > 1 ? (
                <Link className="rounded border border-[var(--border)] px-2 py-1" href={href(group, page.page - 1)}>
                  Prev
                </Link>
              ) : (
                <span className="rounded border border-[var(--border)] px-2 py-1 opacity-40">Prev</span>
              )}
              <span>
                Page {page.page} of {totalPages}
              </span>
              {page.page < totalPages ? (
                <Link className="rounded border border-[var(--border)] px-2 py-1" href={href(group, page.page + 1)}>
                  Next
                </Link>
              ) : (
                <span className="rounded border border-[var(--border)] px-2 py-1 opacity-40">Next</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportPanel({ summary }: { summary: LegacySummary }) {
  const [pending, run] = useRefreshingAction();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-sm">
        <div>
          <span className="font-semibold">{summary.toImport.toLocaleString()}</span> approved and ready to import ·{" "}
          <span className="font-semibold">{summary.imported.toLocaleString()}</span> already in Members
        </div>
        {summary.awaitingReview > 0 && (
          <div className="mt-1 text-[var(--muted)]">{summary.awaitingReview} still need a decision -- you can import now and do those later.</div>
        )}
        {result && <div className="mt-2 text-[var(--success-text)]">{result}</div>}
        {error && <div className="mt-2 text-[var(--danger-text)]">{error}</div>}
      </div>
      <button
        className="btn-primary !px-4 !py-2 text-sm"
        disabled={pending || summary.toImport === 0}
        onClick={() => {
          if (!confirm(`Copy ${summary.toImport.toLocaleString()} approved accounts into Members as free Insiders? No emails are sent and no logins are created.`)) return;
          setResult(null);
          setError(null);
          run(async () => {
            const r = await importApprovedLegacyAccounts();
            if (!r.ok) return setError(r.error);
            const parts = [`Added ${r.added.toLocaleString()} new members`];
            if (r.linked) parts.push(`linked ${r.linked} who were already members`);
            if (r.skipped.length) parts.push(`skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).join("; ")}${r.skipped.length > 3 ? "…" : ""}`);
            setResult(parts.join(", ") + ".");
          });
        }}
      >
        {pending ? "Importing…" : `Import ${summary.toImport.toLocaleString()} approved`}
      </button>
    </div>
  );
}

function Row({ row }: { row: LegacyAccount }) {
  const [pending, run] = useRefreshingAction();
  const [error, setError] = useState<string | null>(null);
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "(no name)";

  function decide(decision: "import" | "skip") {
    setError(null);
    run(async () => {
      const r = await setLegacyDecision(row.legacy_user_id, decision);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1.4fr_1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-xs text-[var(--muted)]">
          {row.email ?? "no email"} · {row.phone ?? "no phone"} · joined {joined(row.joined_at)}
        </div>
      </div>
      <div className="min-w-0 text-xs">
        <div className="truncate">{oldPlan(row)}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {row.reasons.map((reason) => (
            <span key={reason} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
              {reason}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        {row.imported_member_id ? (
          <Link href={`/admin/members/${row.imported_member_id}`} className="text-xs font-semibold text-[var(--success-text)] hover:underline">
            In Members ✓
          </Link>
        ) : (
          <>
            <button
              disabled={pending}
              onClick={() => decide("import")}
              className={`rounded border px-2.5 py-1 text-xs ${row.decision === "import" ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`}
            >
              Import
            </button>
            <button
              disabled={pending}
              onClick={() => decide("skip")}
              className={`rounded border px-2.5 py-1 text-xs ${row.decision === "skip" ? "border-[var(--danger-text)] bg-[var(--danger-text)] text-white" : "border-[var(--border)] hover:border-[var(--danger-text)]"}`}
            >
              Skip
            </button>
            {row.decided_by && <span className="text-[10px] text-[var(--muted)]">set by hand</span>}
          </>
        )}
        {error && <span className="text-xs text-[var(--danger-text)]">{error}</span>}
      </div>
    </div>
  );
}
