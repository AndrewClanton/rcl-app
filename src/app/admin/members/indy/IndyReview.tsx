"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { IndyAccount, IndyMatch, IndySummary, IndyTab } from "@/lib/data/indy";
import { NEVER_MAIL_REASON, type IndyFillField, type IndyImportPreview } from "@/lib/indy-rules";
import { birthdayLabel } from "@/lib/visits";
import PageHeader from "@/components/admin/PageHeader";
import ConfirmModal from "@/components/ConfirmModal";
import { approveAllNewIndy, importApprovedIndyAccounts, setIndyChoice, type IndyChoice } from "./actions";

const TAB_INFO: Record<IndyTab, { label: string; hint: string }> = {
  new: {
    label: "New",
    hint: "No member matches. Nobody here goes in until you approve them (one by one, or Approve all new). Then Import makes each a free Insider with email on, whatever they answered on Indy. Anyone on our never-mail list (unsubscribed from us, bounced or complained) goes back to Conflict instead.",
  },
  fill: {
    label: "Fill",
    hint: "Matched to one member. These go in at the next Import unless you skip them: Import fills only what that member has empty (phone, birthday, a placeholder name) and never changes their email address or email setting.",
  },
  conflict: { label: "Conflict", hint: "The matches disagree. Pick the member to fill, add them as a new member, or skip." },
  skip: {
    label: "Skip",
    hint: "Staff and owner accounts, test accounts, people with no email or phone, anyone removed at their request, and the ones you skipped. Not imported.",
  },
};
const ORDER: IndyTab[] = ["new", "fill", "conflict", "skip"];
const FIELD_LABEL: Record<IndyFillField, string> = { phone: "phone", birthday: "birthday", name: "name" };

function tabCount(summary: IndySummary, tab: IndyTab) {
  return tab === "skip" ? summary.classes.skip + summary.skippedByHand : summary.classes[tab];
}

// What pressing Import would do, in words ("adds 12 new Insiders with
// email on, fills details on 40 members, ...").
function previewWords(p: IndyImportPreview): string[] {
  return [
    p.newMembers ? `adds ${p.newMembers.toLocaleString()} new Insider${p.newMembers === 1 ? "" : "s"} with email on` : null,
    p.fills ? `fills details on ${p.fills.toLocaleString()} member${p.fills === 1 ? "" : "s"}` : null,
    p.links ? `links ${p.links.toLocaleString()} with nothing to fill` : null,
  ].filter((x): x is string => !!x);
}

function onIndy(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "—";
}

// A plain date ("2025-06-14"), shown as that day wherever you are.
function day(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function listWords(words: string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export default function IndyReview({
  summary,
  tab,
  query,
  page,
  pageSize,
}: {
  summary: IndySummary;
  tab: IndyTab;
  query: string;
  page: { rows: IndyAccount[]; total: number; page: number };
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
      const params = new URLSearchParams({ tab });
      if (search.trim()) params.set("q", search.trim());
      router.push(`/admin/members/indy?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(page.total / pageSize));
  const href = (t: IndyTab, p = 1) => {
    const params = new URLSearchParams({ tab: t });
    if (t === tab && search.trim()) params.set("q", search.trim());
    if (p > 1) params.set("page", String(p));
    return `/admin/members/indy?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        back={{ href: "/admin/members", label: "Members" }}
        title="Indy members"
        purpose={
          <>
            Everyone from Indy, the ticketing system before this app, sorted against Members. Nothing changes in Members until you press Import, and
            importing doesn&apos;t send any email or create logins. New people join with email on; members already here keep their email setting.
            Points, visits, photos, addresses and paid Indy plans are not brought over.
          </>
        }
      />

      <SummaryPanel summary={summary} />
      <ImportPanel summary={summary} />

      <div className="flex flex-wrap gap-2">
        {ORDER.map((t) => (
          <Link
            key={t}
            href={href(t)}
            className={`rounded-full border px-3 py-1 text-sm ${t === tab ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`}
          >
            {TAB_INFO[t].label} <span className="opacity-70">{tabCount(summary, t).toLocaleString()}</span>
            {t === "conflict" && summary.awaitingReview > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-white">{summary.awaitingReview} left</span>
            )}
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <p className="max-w-2xl text-sm text-[var(--muted)]">{TAB_INFO[tab].hint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <BulkButtons tab={tab} summary={summary} />
            <input
              className="min-w-[220px] rounded border border-[var(--border)] px-2 py-1 text-sm"
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {page.rows.map((r) => (
            <Row key={r.indy_user_id} row={r} />
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
                <Link className="rounded border border-[var(--border)] px-2 py-1" href={href(tab, page.page - 1)}>
                  Prev
                </Link>
              ) : (
                <span className="rounded border border-[var(--border)] px-2 py-1 opacity-40">Prev</span>
              )}
              <span>
                Page {page.page} of {totalPages}
              </span>
              {page.page < totalPages ? (
                <Link className="rounded border border-[var(--border)] px-2 py-1" href={href(tab, page.page + 1)}>
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

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
      {note && <div className="text-xs text-[var(--muted)]">{note}</div>}
    </div>
  );
}

function SummaryPanel({ summary }: { summary: IndySummary }) {
  const total = Object.values(summary.classes).reduce((a, b) => a + b, 0);
  return (
    <div className="card space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Fill" value={summary.classes.fill} note="already members" />
        <Stat label="New" value={summary.classes.new} note="free Insiders once you approve" />
        <Stat label="Conflict" value={summary.classes.conflict} note="need a pick" />
        <Stat
          label="Skip"
          value={summary.classes.skip}
          note={summary.skippedByHand > 0 ? `not imported · ${summary.skippedByHand.toLocaleString()} more skipped by you` : "not imported"}
        />
      </div>
      <div className="space-y-1 border-t border-[var(--border)] pt-3 text-sm">
        <div>
          {total.toLocaleString()} from Indy: <span className="font-semibold">{summary.saidYes.toLocaleString()}</span> said yes to email there,{" "}
          <span className="font-semibold">{summary.saidNo.toLocaleString()}</span> said no
          {summary.saidNoNew > 0 && <> ({summary.saidNoNew.toLocaleString()} of them in New)</>}.
        </div>
        <div className="text-[var(--muted)]">
          For information only: Indy answers don&apos;t decide anyone&apos;s email here. New people join with email on. Members already here keep the
          email setting they have with us. Anyone who unsubscribed from us, bounced or complained stays off.
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ summary }: { summary: IndySummary }) {
  const [pending, run] = useRefreshingAction();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catchUp = summary.consentTables === true ? summary.consentPending : 0;
  const n = summary.toImport;

  function go() {
    setResult(null);
    setError(null);
    run(async () => {
      const r = await importApprovedIndyAccounts();
      if (!r.ok) {
        setError(r.error);
        return r;
      }
      const parts = [
        r.added ? `added ${r.added.toLocaleString()} new members` : null,
        r.filled ? `filled details on ${r.filled.toLocaleString()}` : null,
        r.linked ? `linked ${r.linked.toLocaleString()} with nothing to fill` : null,
      ].filter(Boolean);
      let msg = parts.length ? `Done: ${parts.join(", ")}.` : "Nothing new to import.";
      if (r.sentBack.length)
        msg += ` Sent ${r.sentBack.length} back to Conflict: ${r.sentBack.slice(0, 3).join("; ")}${r.sentBack.length > 3 ? "…" : ""}.`;
      if (r.consentRecorded) msg += ` Recorded ${r.consentRecorded.toLocaleString()} Indy email answers.`;
      if (r.consent === "waiting") msg += " The email tables aren't set up yet: each answer is kept here and recorded by a later Import.";
      if (r.remaining) msg += ` ${r.remaining.toLocaleString()} left: run it again to continue.`;
      setResult(msg);
      return r;
    }, { quiet: true });
  }

  const words = previewWords(summary.preview);
  const erased = summary.erasedBeforeLoad ?? 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="max-w-2xl text-sm">
        <div>
          <span className="font-semibold">{n.toLocaleString()}</span> ready to import ·{" "}
          <span className="font-semibold">{summary.imported.toLocaleString()}</span> already in Members
        </div>
        {words.length > 0 && <div className="mt-1">Import {words.join(", ")}.</div>}
        {summary.newUnapproved > 0 && (
          <div className="mt-1 text-[var(--muted)]">
            {summary.newUnapproved.toLocaleString()} new {summary.newUnapproved === 1 ? "person waits" : "people wait"} for you to approve them on the New tab.
            They stay out until you do.
          </div>
        )}
        {erased > 0 && (
          <div className="mt-1 text-[var(--accent)]">
            {erased.toLocaleString()} {erased === 1 ? "member was" : "members were"} removed at their request before the last Indy load. The sort
            can&apos;t recognise them, so one could be sitting in New: look New over before approving.
          </div>
        )}
        {summary.neverMailList === false && (
          <div className="mt-1 text-[var(--muted)]">
            The never-mail list isn&apos;t set up yet (it comes with email marketing), so Import can&apos;t check new people against it.
          </div>
        )}
        {summary.awaitingReview > 0 && (
          <div className="mt-1 text-[var(--muted)]">{summary.awaitingReview} conflicts still need a pick. You can import now and do those later.</div>
        )}
        {catchUp > 0 && <div className="mt-1 text-[var(--muted)]">{catchUp} imported people&apos;s Indy answers still go into the email tables. Import does that too.</div>}
        {result && <div className="mt-2 text-[var(--success-text)]">{result}</div>}
        {error && <div className="mt-2 text-[var(--danger-text)]">{error}</div>}
      </div>
      <button className="btn-primary !px-4 !py-2 text-sm" disabled={pending || (n === 0 && catchUp === 0)} onClick={() => setConfirming(true)}>
        {pending ? "Importing…" : n === 0 && catchUp > 0 ? `Record Indy answers (${catchUp.toLocaleString()})` : `Import (${n.toLocaleString()})`}
      </button>
      {confirming && (
        <ConfirmModal
          title={n > 0 ? `Import ${n.toLocaleString()} from Indy?` : `Record ${catchUp.toLocaleString()} Indy answers?`}
          description={
            n > 0
              ? `This ${words.join(", ")}. New people join with email on, whatever they said on Indy, unless they're on our never-mail list (those go back to Conflict). Matched members get only their empty details filled; their email address and email setting don't change. Nothing is emailed and no logins are made.${summary.newUnapproved > 0 ? ` The ${summary.newUnapproved.toLocaleString()} new people you haven't approved stay out.` : ""} This can't be undone from here.`
              : "Writes each imported person's Indy email answer into the email tables. Nobody's email setting changes."
          }
          confirmLabel={n > 0 ? "Import" : "Record"}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            go();
          }}
        />
      )}
    </div>
  );
}

function BulkButtons({ tab, summary }: { tab: IndyTab; summary: IndySummary }) {
  const [pending, run] = useRefreshingAction();
  const [confirmApprove, setConfirmApprove] = useState(false);
  if (tab !== "new") return null;
  const waiting = summary.newUnapproved;
  return (
    <>
      <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={pending || waiting === 0} onClick={() => setConfirmApprove(true)}>
        Approve all new ({waiting.toLocaleString()})
      </button>
      {confirmApprove && (
        <ConfirmModal
          title={`Approve ${waiting.toLocaleString()} new?`}
          description="Each becomes a free Insider with email on the next time you press Import, whatever they answered on Indy. Anyone on our never-mail list goes back to Conflict instead. Ones you skipped stay skipped. Nothing changes in Members until Import."
          confirmLabel="Approve all"
          onCancel={() => setConfirmApprove(false)}
          onConfirm={() => {
            setConfirmApprove(false);
            run(() => approveAllNewIndy());
          }}
        />
      )}
    </>
  );
}

function MemberLine({ label, member }: { label: string; member: IndyMatch | null }) {
  if (!member) return null;
  return (
    <div className="truncate">
      {label}{" "}
      <Link href={`/admin/members/${member.id}`} className="font-medium hover:underline">
        {member.name || "(no name)"}
      </Link>
      <span className="text-[var(--muted)]">
        {" "}
        · {member.email ?? "no email"} · {member.phone ?? "no phone"}
      </span>
    </div>
  );
}

// What pressing Import will do with this row, in words.
function outcome(row: IndyAccount): string {
  if (row.erased_at) return "Removed at their request. Never imported.";
  if (row.imported_member_id) return "Imported.";
  if (row.decision === "skip") return "Skipped: not imported.";
  if (row.decision === "review" || !row.import_as) return "Needs a pick.";
  if (row.import_as === "new") {
    const extras = [row.phone && "phone", row.birthday && "birthday"].filter((x): x is string => !!x);
    const adds = `a new Insider with email on${extras.length ? `, with their ${listWords(extras)}` : ""}`;
    return row.decided_by ? `Adds ${adds}.` : `Waits for you to approve. Then Import adds ${adds}.`;
  }
  const fields = row.planned_fills.map((f) => FIELD_LABEL[f]);
  return `${fields.length ? `Fills ${listWords(fields)} on the member below.` : "Nothing to fill; links the Indy account to the member below."} Their email setting stays as it is.`;
}

function Toggle({ on, danger, disabled, onClick, children }: { on: boolean; danger?: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  const onClass = danger ? "border-[var(--danger-text)] bg-[var(--danger-text)] text-white" : "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]";
  const offClass = danger ? "border-[var(--border)] hover:border-[var(--danger-text)]" : "border-[var(--border)] hover:border-[var(--foreground)]";
  return (
    <button disabled={disabled} onClick={onClick} className={`rounded border px-2.5 py-1 text-xs ${on ? onClass : offClass}`}>
      {children}
    </button>
  );
}

function Row({ row }: { row: IndyAccount }) {
  const [pending, run, error] = useRefreshingAction();
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "(no name)";
  const bday = birthdayLabel(row.birthday);
  const plan = row.indy_membership && row.indy_membership.toLowerCase() !== "royale insiders" ? row.indy_membership : null;
  const choose = (choice: IndyChoice) => run(() => setIndyChoice(row.indy_user_id, choice), { quiet: true });
  const importing = row.decision === "import";
  // A new row is only approved once a person said so: the loader's default
  // doesn't count.
  const approved = importing && (row.import_as !== "new" || !!row.decided_by);
  const picked = (asNew: boolean, target: string | null) => importing && (asNew ? row.import_as === "new" : row.import_as === "fill" && !!target && row.target_member_id === target);

  let controls: React.ReactNode = null;
  if (row.imported_member_id) {
    controls = (
      <Link href={`/admin/members/${row.imported_member_id}`} className="text-xs font-semibold text-[var(--success-text)] hover:underline">
        In Members ✓
      </Link>
    );
  } else if (row.erased_at || row.classification === "skip") {
    controls = null;
  } else if (row.classification === "conflict") {
    controls = (
      <>
        {row.email_member_id && (
          <Toggle on={picked(false, row.email_member_id)} disabled={pending} onClick={() => choose("fill_email")}>
            Fill email match
          </Toggle>
        )}
        {row.phone_member_id && row.phone_member_id !== row.email_member_id && (
          <Toggle on={picked(false, row.phone_member_id)} disabled={pending} onClick={() => choose("fill_phone")}>
            Fill phone match
          </Toggle>
        )}
        {row.email && !row.email_member_id && !row.reasons.includes(NEVER_MAIL_REASON) && (
          <Toggle on={picked(true, null)} disabled={pending} onClick={() => choose("new")}>
            Add as new
          </Toggle>
        )}
        <Toggle on={row.decision === "skip"} danger disabled={pending} onClick={() => choose("skip")}>
          Skip
        </Toggle>
      </>
    );
  } else {
    controls = (
      <>
        <Toggle on={approved} disabled={pending} onClick={() => choose("import")}>
          {row.import_as === "new" ? (approved ? "Approved" : "Approve") : "Import"}
        </Toggle>
        <Toggle on={row.decision === "skip"} danger disabled={pending} onClick={() => choose("skip")}>
          Skip
        </Toggle>
      </>
    );
  }

  return (
    <div className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[1.1fr_1.5fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          <span
            className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
            title="What they answered on Indy. Information only: it doesn't decide their email here."
          >
            {row.said_yes ? "said yes on Indy" : "said no on Indy"}
          </span>
        </div>
        <div className="truncate text-xs text-[var(--muted)]">
          {row.email ?? "no email"} · {row.phone ?? "no phone"}
          {bday && <> · birthday {bday}</>}
        </div>
        <div className="truncate text-xs text-[var(--muted)]">
          On Indy since {onIndy(row.indy_created_at)}
          {row.indy_last_visit && <> · last visit {day(row.indy_last_visit)}</>}
          {plan && <> · {plan} (not carried over)</>}
          {!!row.indy_points && <> · {Number(row.indy_points).toLocaleString()} Indy points (not imported)</>}
        </div>
      </div>
      <div className="min-w-0 space-y-1 text-xs">
        <div>{outcome(row)}</div>
        {row.classification === "conflict" ? (
          <>
            <MemberLine label="Email matches" member={row.email_member} />
            <MemberLine label="Phone matches" member={row.phone_member} />
            {row.target_member && row.target_member_id !== row.email_member_id && row.target_member_id !== row.phone_member_id && (
              <MemberLine label="Filling" member={row.target_member} />
            )}
          </>
        ) : (
          <MemberLine label="Member:" member={row.target_member} />
        )}
        {row.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.reasons.map((reason) => (
              <span key={reason} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                {reason}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {controls}
        {row.decided_by && !row.imported_member_id && <span className="text-[10px] text-[var(--muted)]">set by hand</span>}
        {error && <span className="text-xs text-[var(--danger-text)]">{error}</span>}
      </div>
    </div>
  );
}
