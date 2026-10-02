"use client";

import { useState } from "react";
import type { AdminRoadmapItem } from "@/lib/data/roadmap";
import { ROADMAP_STATUSES, STATUS_LABEL, releaseLabel, shortDate, timeAgo, type RoadmapStatus } from "@/lib/roadmap";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { StatusTag } from "@/components/roadmap/board";
import SideSheet from "@/components/admin/SideSheet";
import { setRoadmapStatus, updateRoadmapItem } from "./actions";
import { ItemForm, STATUS_HINT } from "./forms";

// One item, opened from its card: where it is, who asked, its internal
// notes and the full edit form. Owners and admins can change it; managers
// see it all. The server checks the role again on every action.

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
  const [editing, setEditing] = useState(false);
  const requester = item.requester.memberId ? item.requester.memberName : item.requester.name;
  const release = releaseLabel(item.shippedInVersion);

  return (
    <SideSheet
      top={<StatusTag status={item.status} position={position} />}
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
          {error && (
            <p className="notice notice-warn" role="alert">
              {error}
            </p>
          )}
          {editing ? (
            <Block title="Edit">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <ItemForm
                  initial={{
                    title: item.title,
                    summary: item.summary,
                    notes: item.internalNotes,
                    status: item.status,
                    requesterMemberId: item.requester.memberId,
                    requesterName: item.requester.name,
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
          )}
        </>
      ) : (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">Owners and admins move items along and edit them. You can read everything here.</p>
      )}

      <Block title="Details">
        <dl className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
          <Row k="Summary">{item.summary ? <span className="whitespace-pre-line">{item.summary}</span> : <span className="text-[var(--muted)]">None yet.</span>}</Row>
          <Row k="Who asked">
            {requester ? (
              item.requester.memberId ? (
                <a href={`/admin/members/${item.requester.memberId}`} className="font-semibold underline">
                  {requester}
                </a>
              ) : (
                <span className="font-semibold">{requester}</span>
              )
            ) : (
              <span className="text-[var(--muted)]">Nobody: our idea</span>
            )}
          </Row>
          {item.status === "live" && (
            <Row k="Shipped">
              {item.shippedAt ? fmt(item.shippedAt) : "Yes"}
              {release && <span className="text-[var(--muted)]"> · release {release}</span>}
              {showVersions && item.shippedInVersion && <span className="font-mono text-xs text-[var(--muted)]"> ({item.shippedInVersion})</span>}
            </Row>
          )}
          <Row k="Added">{fmt(item.createdAt)}</Row>
        </dl>
      </Block>

      <Block title="Internal notes">
        {item.internalNotes ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm whitespace-pre-wrap">{item.internalNotes}</p>
        ) : (
          <p className="text-sm text-[var(--muted)]">None.</p>
        )}
      </Block>

      {item.notes.length > 0 && (
        <Block title={`Member notes (${item.notes.length})`} hint="Left by members when the list had a public page.">
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
        </Block>
      )}
    </SideSheet>
  );
}
