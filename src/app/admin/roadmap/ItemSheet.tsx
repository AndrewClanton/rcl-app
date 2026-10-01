"use client";

import { useState } from "react";
import type { AdminRoadmapItem } from "@/lib/data/roadmap";
import { ROADMAP_STATUSES, STATUS_LABEL, releaseLabel, shortDate, timeAgo, type RoadmapStatus } from "@/lib/roadmap";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { StatusTag } from "@/components/roadmap/board";
import SideSheet from "@/components/admin/SideSheet";
import { setRoadmapPublic, setRoadmapStatus, updateRoadmapItem } from "./actions";
import { CopyShareLink, ItemForm, STATUS_HINT } from "./forms";
import { EyeIcon, LockIcon, Visibility } from "./staff";

// One item, opened from its card: where it is, who can see it, its share
// link, the details only staff see (who asked, internal notes, members'
// notes) and the full edit form. Owners and admins can change it; managers
// see it all and copy the link. The server checks the role again on every
// action.

export function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function Block({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-bold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 py-2">
      <dt className="w-28 shrink-0 text-xs text-[var(--muted)] sm:pt-0.5">{k}</dt>
      <dd className="min-w-0 flex-1 text-sm">{children}</dd>
    </div>
  );
}

export default function ItemSheet({
  item,
  position,
  canEdit,
  showVersions,
  now,
  onClose,
}: {
  item: AdminRoadmapItem;
  position: number | null;
  canEdit: boolean;
  showVersions: boolean;
  now: number;
  onClose: () => void;
}) {
  const [pending, run, error] = useRefreshingAction();
  const [confirmPublic, setConfirmPublic] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const requester = item.requester.memberId ? item.requester.memberName : item.requester.name;
  const release = releaseLabel(item.shippedInVersion);

  function setPublic(on: boolean) {
    if (on === item.isPublic) return;
    setConfirmPublic(null);
    run(async () => {
      const r = await setRoadmapPublic(item.id, on);
      if (!r.ok && r.confirm) {
        setConfirmPublic(r.error);
        return null;
      }
      return r;
    });
  }

  const choice = (on: boolean, icon: React.ReactNode, label: string, hint: string) => {
    const chosen = item.isPublic === on;
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => setPublic(on)}
        aria-pressed={chosen}
        className={`flex min-h-14 flex-1 basis-48 items-start gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
          chosen ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground)]"
        }`}
      >
        <span className="mt-0.5">{icon}</span>
        <span>
          <span className="block text-sm font-bold">{label}</span>
          <span className={`block text-xs ${chosen ? "opacity-80" : "text-[var(--muted)]"}`}>{hint}</span>
        </span>
      </button>
    );
  };

  return (
    <SideSheet
      top={
        <>
          <StatusTag status={item.status} position={position} />
          <Visibility isPublic={item.isPublic} />
        </>
      }
      title={item.title}
      subtitle={
        item.status === "live" && item.shippedAt ? `Shipped ${fmt(item.shippedAt)}` : `${STATUS_LABEL[item.status]} since ${shortDate(item.statusChangedAt)} (${timeAgo(item.statusChangedAt, now)})`
      }
      onClose={onClose}
    >
      {canEdit ? (
        <>
          <Block title="Where is it?" hint="Tap to move it. Going live stamps today's date and the release it shipped in.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROADMAP_STATUSES.map((s: RoadmapStatus) => {
                const here = item.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={pending || here}
                    onClick={() => run(() => setRoadmapStatus(item.id, s))}
                    aria-pressed={here}
                    className={`min-h-14 rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                      here ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground)] disabled:opacity-60"
                    }`}
                  >
                    <span className="block text-sm font-bold">{STATUS_LABEL[s]}</span>
                    <span className={`block text-xs ${here ? "opacity-80" : "text-[var(--muted)]"}`}>{here ? "It's here now" : STATUS_HINT[s]}</span>
                  </button>
                );
              })}
            </div>
          </Block>

          <Block title="Who can see it?">
            <div className="flex flex-wrap gap-2">
              {choice(true, <EyeIcon className="h-4 w-4" />, "On the public page", "Customers see it on What's new")}
              {choice(false, <LockIcon className="h-4 w-4" />, "Staff only", "Only the back office sees it")}
            </div>
            {confirmPublic && (
              <div className="notice notice-warn mt-2" role="alert">
                {confirmPublic}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmPublic(null);
                    run(() => setRoadmapPublic(item.id, true, true));
                  }}
                  className="mt-2 block min-h-11 font-bold underline"
                >
                  It&apos;s a false alarm: make it public anyway
                </button>
              </div>
            )}
          </Block>
          {error && (
            <p className="notice notice-warn" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
          Owners and admins move items along and choose what&apos;s on the public page. You can copy its link and read everything here.
        </p>
      )}

      <Block title="Share it" hint={item.isPublic ? "Send the link to whoever asked, so they can follow it." : "Staff only for now: the link works once it's on the public page."}>
        <div className="flex flex-wrap items-center gap-2">
          <CopyShareLink slug={item.slug} isPublic={item.isPublic} />
          {item.isPublic && (
            <a href={`/whats-new/${item.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline">
              View on What&apos;s new ↗
            </a>
          )}
        </div>
      </Block>

      {canEdit &&
        (editing ? (
          <Block title="Edit">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <ItemForm
                initial={{
                  title: item.title,
                  summary: item.summary,
                  notes: item.internalNotes,
                  status: item.status,
                  isPublic: item.isPublic,
                  requesterMemberId: item.requester.memberId,
                  requesterName: item.requester.name,
                  creditOk: item.creditOk,
                }}
                requesterLabel={item.requester.memberName}
                submitLabel="Save"
                onSave={(input) => updateRoadmapItem(item.id, input)}
                onDone={() => setEditing(false)}
              />
            </div>
          </Block>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="btn-secondary min-h-11 w-full sm:w-auto">
            Edit the title, summary, notes or who asked
          </button>
        ))}

      <Block title="Details">
        <dl className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
          <Row k="Public summary">{item.summary ? <span className="whitespace-pre-line">{item.summary}</span> : <span className="text-[var(--muted)]">None yet. It needs one before it can go on the public page.</span>}</Row>
          <Row k="Who asked">
            {requester ? (
              <>
                {item.requester.memberId ? (
                  <a href={`/admin/members/${item.requester.memberId}`} className="font-semibold underline">
                    {requester}
                  </a>
                ) : (
                  <span className="font-semibold">{requester}</span>
                )}
                {item.fromSuggestion && <span className="text-[var(--muted)]"> · from the inbox</span>}
              </>
            ) : (
              <span className="text-[var(--muted)]">Nobody: our idea</span>
            )}
          </Row>
          {requester && (
            <Row k="Public credit">
              {item.publicCredit ? (
                <>Shows &quot;Suggested by {item.publicCredit}&quot;</>
              ) : item.creditOk ? (
                <span className="text-[var(--muted)]">Hidden: staff, and names that match staff, are never credited</span>
              ) : (
                <span className="text-[var(--muted)]">None: no OK to credit them</span>
              )}
            </Row>
          )}
          <Row k="Members want it">
            <span className="tabular-nums">{item.votes}</span>
          </Row>
          {item.status === "live" && (
            <Row k="Shipped">
              {item.shippedAt ? fmt(item.shippedAt) : "Yes"}
              {release && (showVersions || item.isPublic) && <span className="text-[var(--muted)]"> · release {release}</span>}
              {showVersions && item.shippedInVersion && <span className="font-mono text-xs text-[var(--muted)]"> ({item.shippedInVersion})</span>}
            </Row>
          )}
          <Row k="Added">{fmt(item.createdAt)}</Row>
        </dl>
      </Block>

      <Block title="Internal notes" hint="Staff only, never public.">
        {item.internalNotes ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm whitespace-pre-wrap">{item.internalNotes}</p>
        ) : (
          <p className="text-sm text-[var(--muted)]">None.</p>
        )}
      </Block>

      <Block title={`Member notes (${item.notes.length})`} hint="What members told the crew from its page. Private: never shown publicly.">
        {item.notes.length ? (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {item.notes.map((n) => (
              <li key={n.id} className="px-3 py-2.5 text-sm">
                <span className="text-xs text-[var(--muted)]">
                  <a href={`/admin/members/${n.memberId}`} className="font-semibold text-[var(--foreground)] underline">
                    {n.memberName}
                  </a>{" "}
                  · {fmt(n.createdAt)}
                </span>
                <p className="mt-0.5 whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted)]">None yet.</p>
        )}
      </Block>
    </SideSheet>
  );
}
