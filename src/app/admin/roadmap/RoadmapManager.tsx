"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminRoadmapItem, AdminSuggestion } from "@/lib/data/roadmap";
import { canVote, releaseLabel, shippedByDay } from "@/lib/roadmap";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import PageHeader from "@/components/admin/PageHeader";
import SideSheet from "@/components/admin/SideSheet";
import { BoardStat, BuildingCard, IdeaCard, LiveBoard, QueueCard, SectionHead, ShippedDay, ShippedRow } from "@/components/roadmap/board";
import { createRoadmapItem, declineRoadmapSuggestion, reopenRoadmapSuggestion } from "./actions";
import { ItemForm, LogRequestForm } from "./forms";
import ItemSheet, { fmt } from "./ItemSheet";
import QueueList from "./QueueList";
import { STAFF_ONLY_GROUND, StaffStrip, TitleButton, Visibility, VoteLook, VoteTally, boardItem, lastChange } from "./staff";

// Back office → Roadmap & What's new. The same board customers see on What's
// new (Building now, Up next with its "#3 in line" tickets, Ideas, Just
// shipped a day at a time), with everything on it: staff-only items are
// hatched and marked, and a strip under each card says who can see it, who
// asked and opens it to manage. "As customers see it" shows exactly what's
// public. The suggestions inbox sits up top while it has anything new.
//
// canEdit: owners and admins (add, edit, reorder, status, publish, the
// inbox). Managers see everything and log requests. The server checks the
// role again on every action.

const SHIPPED_SHOWN = 12;
const WEEK_MS = 7 * 86_400_000;

type Sheet = { kind: "item"; id: string } | { kind: "add"; suggestion: AdminSuggestion | null } | { kind: "log" };

function shippedAt(i: AdminRoadmapItem) {
  return i.shippedAt ?? i.statusChangedAt;
}

// The board's sections, sorted the way What's new sorts them. Items arrive
// in line order.
function sections(items: AdminRoadmapItem[]) {
  return {
    building: [...items.filter((i) => i.status === "building"), ...items.filter((i) => i.status === "reviewing")],
    queued: items.filter((i) => i.status === "queued"),
    ideas: items.filter((i) => i.status === "idea").sort((a, b) => b.votes - a.votes),
    shipped: items.filter((i) => i.status === "live").sort((a, b) => shippedAt(b).localeCompare(shippedAt(a)) || a.rank - b.rank),
    notDoing: items.filter((i) => i.status === "not_doing"),
  };
}

const staffOnlyCard = (i: AdminRoadmapItem) => (i.isPublic ? "" : `border-dashed shadow-none ${STAFF_ONLY_GROUND}`);

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5 text-[15px] text-[var(--muted)]">{children}</p>;
}

export default function RoadmapManager({
  items,
  inbox,
  decided,
  canEdit,
  version,
  showVersions,
  now,
}: {
  items: AdminRoadmapItem[];
  inbox: AdminSuggestion[];
  decided: AdminSuggestion[];
  canEdit: boolean;
  version: string | null;
  showVersions: boolean;
  now: number;
}) {
  const [view, setView] = useState<"staff" | "customers">("staff");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [allShipped, setAllShipped] = useState(false);
  const open = (id: string) => setSheet({ kind: "item", id });
  const close = () => setSheet(null);

  const publicItems = items.filter((i) => i.isPublic);
  const all = sections(items);
  const pub = sections(publicItems);
  // "#3 in line": public items only, so a staff-only one never leaves a gap.
  const positions = new Map(pub.queued.map((i, n) => [i.id, n + 1]));
  const board = view === "staff" ? all : pub;
  const shippedThisWeek = board.shipped.filter((i) => Date.parse(shippedAt(i)) >= now - WEEK_MS).length;
  const notes = items.reduce((n, i) => n + i.notes.length, 0);
  const sheetItem = sheet?.kind === "item" ? items.find((i) => i.id === sheet.id) : undefined;

  const staffProps = (i: AdminRoadmapItem) => ({
    title: <TitleButton title={i.title} onOpen={() => open(i.id)} />,
    // Members can only vote on what's public, so a staff-only item shows a
    // count only if it has one from before.
    vote: view === "customers" ? <VoteLook votes={i.votes} open={canVote(i.status)} /> : i.isPublic || i.votes ? <VoteTally votes={i.votes} live={i.status === "live"} /> : null,
    staff: view === "staff" ? <StaffStrip item={i} canEdit={canEdit} onOpen={() => open(i.id)} /> : undefined,
    className: view === "staff" ? staffOnlyCard(i) : "",
  });

  const shippedList = allShipped ? board.shipped : board.shipped.slice(0, SHIPPED_SHOWN);
  const shippedSection = (
    <section id="shipped" aria-labelledby="shipped-h" className="scroll-mt-4">
      <SectionHead compact id="shipped-h" kicker="Fresh off the press" title="Just shipped" count={view === "staff" ? board.shipped.length : undefined}>
        {view === "staff" && version && (
          <p className="max-w-xs text-xs text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">
              This build: <span className="font-mono">{version}</span>
            </span>
            <br />
            Owners only. Going live stamps an item with the release it shipped in.
          </p>
        )}
      </SectionHead>
      {shippedList.length ? (
        <div className="space-y-6">
          {shippedByDay(shippedList, shippedAt, (i) => (showVersions || i.isPublic ? releaseLabel(i.shippedInVersion) : null)).map((d) => (
            <ShippedDay key={d.day} date={d.date} releases={d.releases}>
              {d.items.map((i) => (
                <ShippedRow
                  key={i.id}
                  item={boardItem(i)}
                  title={<TitleButton title={i.title} onOpen={() => open(i.id)} />}
                  className={view === "staff" && !i.isPublic ? `${STAFF_ONLY_GROUND} last:rounded-b-[4px]` : ""}
                  staff={view === "staff" ? <StaffStrip item={i} canEdit={canEdit} onOpen={() => open(i.id)} band={false} release={showVersions ? releaseLabel(i.shippedInVersion) : null} /> : undefined}
                />
              ))}
            </ShippedDay>
          ))}
        </div>
      ) : (
        <Empty>{view === "staff" ? "Nothing shipped yet. Move an item to Live and it lands here." : "The first changes land here soon."}</Empty>
      )}
      {board.shipped.length > shippedList.length && (
        <button type="button" onClick={() => setAllShipped(true)} className="btn-secondary mt-6 min-h-11">
          Show everything shipped ({board.shipped.length})
        </button>
      )}
    </section>
  );

  const buildingSection = (
    <section id="building" aria-labelledby="building-h" className="scroll-mt-4">
      <SectionHead compact id="building-h" kicker="On the workbench" title="Building now" count={board.building.length} live={board.building.length > 0} />
      {board.building.length ? (
        <div className="grid gap-6 @2xl:grid-cols-2">
          {board.building.map((i) => (
            <BuildingCard key={i.id} item={boardItem(i)} now={now} {...staffProps(i)} />
          ))}
        </div>
      ) : (
        <Empty>{view === "staff" ? "Nothing on the workbench. Open something in Up next and move it to Building now." : "Nothing on the workbench this minute. The next thing in line is up soon."}</Empty>
      )}
    </section>
  );

  const queueSection = (
    <section id="up-next" aria-labelledby="up-next-h" className="scroll-mt-4">
      <SectionHead compact id="up-next-h" kicker="The queue" title="Up next" count={board.queued.length}>
        {view === "staff" && canEdit && board.queued.length > 1 && <p className="max-w-xs text-sm text-[var(--muted)]">Drag an item&apos;s ticket, or use the arrows, to change the order.</p>}
      </SectionHead>
      {!board.queued.length ? (
        <Empty>{view === "staff" ? "Nothing in line. Say yes to an idea or a suggestion and it joins the line." : "The line is empty: everything we said yes to is being built or already live. Suggest the next thing!"}</Empty>
      ) : view === "staff" ? (
        <QueueList items={board.queued} canEdit={canEdit} now={now} onOpen={open} />
      ) : (
        <ol className="space-y-4">
          {board.queued.map((i) => (
            <li key={i.id}>
              <QueueCard item={boardItem(i, positions.get(i.id) ?? null)} now={now} {...staffProps(i)} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const ideasSection = (
    <section id="ideas" aria-labelledby="ideas-h" className="scroll-mt-4">
      <SectionHead compact id="ideas-h" kicker={view === "staff" ? "Being considered" : "Tell us what you want"} title="Ideas we're considering" count={board.ideas.length}>
        <p className="max-w-xs text-sm text-[var(--muted)]">{view === "staff" ? "Most wanted first, the way What's new lists them." : "Tap \"I want this too\" on the ones you'd use. The most wanted move up."}</p>
      </SectionHead>
      {board.ideas.length ? (
        <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
          {board.ideas.map((i) => {
            const p = staffProps(i);
            return <IdeaCard key={i.id} item={boardItem(i)} {...p} className={view === "staff" && !i.isPublic ? STAFF_ONLY_GROUND : ""} />;
          })}
        </div>
      ) : (
        <Empty>{view === "staff" ? "No ideas waiting. Accept a suggestion as an Idea, or add one." : "No ideas waiting right now. Yours could be the first."}</Empty>
      )}
    </section>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        area="guests"
        title="Roadmap & What's new"
        purpose={
          <>
            What the crew is building, what&apos;s in line, the ideas and what&apos;s shipped. Each card looks the way customers see it on{" "}
            <Link href="/whats-new" className="font-semibold underline">
              What&apos;s new
            </Link>
            ; the strip under it is for staff. Tap a card to move it along, edit it or copy its link for whoever asked.
          </>
        }
        actions={
          canEdit ? (
            <>
              <button type="button" onClick={() => setSheet({ kind: "add", suggestion: null })} className="btn-primary inline-flex min-h-11 items-center">
                + Add to the list
              </button>
              <button type="button" onClick={() => setSheet({ kind: "log" })} className="btn-secondary inline-flex min-h-11 items-center">
                + Log a request
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSheet({ kind: "log" })} className="btn-primary inline-flex min-h-11 items-center">
              + Log someone&apos;s request
            </button>
          )
        }
      />

      <div className="@container space-y-12">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Show" className="inline-flex rounded-xl border-2 border-[var(--foreground)] bg-[var(--surface)] p-1">
              {(
                [
                  ["staff", "Everything"],
                  ["customers", "As customers see it"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-bold transition-colors ${view === v ? "bg-[var(--foreground)] text-[var(--surface)]" : "hover:bg-[var(--surface-hover)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Link href="/whats-new" target="_blank" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
              Open What&apos;s new ↗
            </Link>
          </div>
          {view === "customers" && (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
              <b>This is What&apos;s new the way customers see it:</b> only items on the public page, in the same order and numbering. Staff-only items, the inbox and members&apos; notes are hidden. Tap
              a title to manage it.
            </p>
          )}

          <LiveBoard
            lastUpdate={lastChange(view === "staff" ? items : publicItems)}
            now={now}
            footer={
              view === "staff" ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-[4px] border-t-2 border-[var(--foreground)] bg-[var(--background)] px-4 py-2.5 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <Visibility isPublic />
                    <b className="tabular-nums">{publicItems.length}</b>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Visibility isPublic={false} />
                    <b className="tabular-nums">{items.length - publicItems.length}</b>
                  </span>
                  <span className="text-[var(--muted)]">
                    <b className="text-[var(--foreground)] tabular-nums">{notes}</b> member note{notes === 1 ? "" : "s"}
                  </span>
                  {inbox.length > 0 && (
                    <a href="#inbox" className="ml-auto inline-flex min-h-11 items-center rounded-full bg-[var(--foreground)] px-4 text-sm font-bold whitespace-nowrap text-[var(--surface)]">
                      {inbox.length} new suggestion{inbox.length === 1 ? "" : "s"} ↓
                    </a>
                  )}
                </div>
              ) : undefined
            }
          >
            <BoardStat k="Building now" v={board.building.length} href="#building" />
            <BoardStat k="In line" v={board.queued.length} href="#up-next" />
            <BoardStat k="Ideas" v={board.ideas.length} href="#ideas" />
            <BoardStat k="Shipped this week" v={shippedThisWeek} href="#shipped" />
          </LiveBoard>
        </div>

        {view === "staff" ? (
          <>
            <Inbox inbox={inbox} decided={decided} canEdit={canEdit} onAccept={(s) => setSheet({ kind: "add", suggestion: s })} />
            {buildingSection}
            {queueSection}
            {ideasSection}
            {shippedSection}
            {all.notDoing.length > 0 && (
              <section id="not-planned" aria-label="Not planned" className="scroll-mt-4">
                <details className="group">
                  <summary className="btn-secondary inline-flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className="transition-transform group-open:rotate-90">
                      ›
                    </span>
                    Not planned ({all.notDoing.length})
                  </summary>
                  <p className="mt-3 text-sm text-[var(--muted)]">Decided against. One that&apos;s on the public page still shows on its own page (as Not planned), so a link someone was sent doesn&apos;t break.</p>
                  <div className="sheet mt-4 !shadow-none">
                    <ul className="divide-y divide-[var(--border)]">
                      {all.notDoing.map((i) => (
                        <ShippedRow
                          key={i.id}
                          item={boardItem(i)}
                          title={<TitleButton title={i.title} onOpen={() => open(i.id)} />}
                          mark={
                            <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[var(--border)] bg-[var(--surface-hover)] text-xs font-bold text-[var(--muted)]">
                              ✕
                            </span>
                          }
                          className={!i.isPublic ? `${STAFF_ONLY_GROUND} last:rounded-b-[4px]` : ""}
                          staff={<StaffStrip item={i} canEdit={canEdit} onOpen={() => open(i.id)} band={false} />}
                        />
                      ))}
                    </ul>
                  </div>
                </details>
              </section>
            )}
          </>
        ) : (
          <>
            {buildingSection}
            {shippedSection}
            {queueSection}
            {ideasSection}
          </>
        )}
      </div>

      {sheetItem && <ItemSheet key={sheetItem.id} item={sheetItem} position={positions.get(sheetItem.id) ?? null} canEdit={canEdit} showVersions={showVersions} now={now} onClose={close} />}

      {sheet?.kind === "add" && (
        <SideSheet title={sheet.suggestion ? "Say yes: put it on the list" : "Add to the list"} subtitle="It starts in line and on the public page; change either below." onClose={close}>
          {sheet.suggestion && (
            <blockquote className="rounded-lg border-l-4 border-[var(--foreground)] bg-[var(--surface)] px-3 py-2 text-sm whitespace-pre-line">
              <span className="block text-xs font-semibold text-[var(--muted)]">{sheet.suggestion.who} asked:</span>
              {sheet.suggestion.body}
            </blockquote>
          )}
          <ItemForm
            initial={{
              title: "",
              summary: "",
              notes: sheet.suggestion ? `From ${sheet.suggestion.who}: ${sheet.suggestion.body}` : "",
              status: "queued",
              isPublic: true,
              requesterMemberId: sheet.suggestion?.memberId ?? null,
              requesterName: sheet.suggestion?.memberId ? null : (sheet.suggestion?.typedName ?? null),
              creditOk: sheet.suggestion?.creditOk ?? false,
            }}
            requesterLabel={sheet.suggestion?.memberId ? sheet.suggestion.who : null}
            submitLabel={sheet.suggestion ? "Add it and accept" : "Add it"}
            onSave={(input) => createRoadmapItem(input, sheet.suggestion?.id ?? null)}
            onDone={close}
            afterSave="share"
          />
        </SideSheet>
      )}

      {sheet?.kind === "log" && (
        <SideSheet title="Log someone's request" subtitle="Someone asked for something at the bar? It goes to the suggestions inbox." onClose={close}>
          <LogRequestForm onDone={close} canEdit={canEdit} />
        </SideSheet>
      )}
    </div>
  );
}

// ---------- the inbox ----------

// Suggestions from members on What's new, and requests staff logged. Up top
// and loud while there's anything new; one quiet line when it's caught up.
function Inbox({ inbox, decided, canEdit, onAccept }: { inbox: AdminSuggestion[]; decided: AdminSuggestion[]; canEdit: boolean; onAccept: (s: AdminSuggestion) => void }) {
  const [pending, run] = useRefreshingAction();
  const [showDecided, setShowDecided] = useState(false);

  const answered = decided.length > 0 && (
    <div className={inbox.length ? "border-t border-[var(--border)] px-4 py-1 sm:px-5" : ""}>
      <button type="button" onClick={() => setShowDecided(!showDecided)} className="min-h-11 text-sm text-[var(--muted)] underline" aria-expanded={showDecided}>
        {showDecided ? "Hide" : "Show"} recently answered ({decided.length})
      </button>
      {showDecided && (
        <ul className="mb-2 space-y-1 text-sm">
          {decided.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)]">
              <span className={`bo-badge ${s.status === "declined" ? "bo-badge-warn" : ""}`}>{s.status === "accepted" ? "Accepted" : "Declined"}</span>
              <span className="font-semibold">{s.who}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{s.body}</span>
              {s.itemTitle && <span className="text-xs">→ {s.itemTitle}</span>}
              {canEdit && s.status === "declined" && (
                <button type="button" disabled={pending} onClick={() => run(() => reopenRoadmapSuggestion(s.id))} className="min-h-11 text-xs underline">
                  Back to the inbox
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!inbox.length) {
    return (
      <section id="inbox" aria-labelledby="inbox-h" className="scroll-mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-3">
          <h2 id="inbox-h" className="min-h-11 content-center text-sm font-bold">
            Suggestions inbox
          </h2>
          <span className="text-sm text-[var(--muted)]">All caught up.</span>
        </div>
        {answered}
      </section>
    );
  }

  return (
    <section id="inbox" aria-labelledby="inbox-h" className="sheet scroll-mt-4">
      <div className="spec-head rounded-t-[4px]">
        <h2 id="inbox-h">Suggestions inbox</h2>
        <span className="rounded-full bg-[var(--gold)] px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-normal text-[var(--foreground)] tabular-nums">{inbox.length} new</span>
      </div>
      <p className="px-4 pt-3 text-sm text-[var(--muted)] sm:px-5">
        From members on What&apos;s new, and requests staff logged. Never shown publicly as written. {canEdit ? "Accept one to put it on the list." : "An owner or admin says yes or no."}
      </p>
      <ul className="divide-y divide-[var(--border)]">
        {inbox.map((s) => (
          <li key={s.id} className="px-4 py-4 sm:px-5">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
              <span className="text-sm font-bold text-[var(--foreground)]">{s.who}</span>
              {s.hint && <span className="font-mono">{s.hint}</span>}
              <span>·</span>
              <span>{fmt(s.createdAt)}</span>
              {s.loggedBy && <span>· logged by {s.loggedBy}</span>}
              {s.creditOk && <span className="bo-badge">Wants credit</span>}
            </div>
            <p className="text-[15px] whitespace-pre-wrap">{s.body}</p>
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => onAccept(s)} className="btn-primary min-h-11">
                  Accept…
                </button>
                <button type="button" disabled={pending} onClick={() => run(() => declineRoadmapSuggestion(s.id))} className="btn-secondary min-h-11">
                  Decline
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {answered}
    </section>
  );
}
