"use client";

import { useState } from "react";
import type { AdminRoadmapItem } from "@/lib/data/roadmap";
import { releaseLabel, shippedByDay } from "@/lib/roadmap";
import PageHeader from "@/components/admin/PageHeader";
import SideSheet from "@/components/admin/SideSheet";
import { BoardStat, BuildingCard, IdeaCard, LiveBoard, SectionHead, ShippedDay, ShippedRow } from "@/components/roadmap/board";
import { createRoadmapItem } from "./actions";
import { ItemForm, LogRequestForm } from "./forms";
import ItemSheet from "./ItemSheet";
import QueueList from "./QueueList";
import { StaffStrip, TitleButton, boardItem, lastChange } from "./staff";

// Back office → Roadmap: the crew's own list of what's being built, what's
// in line, the ideas, and what's shipped a day at a time with its releases.
// Staff only; customers never see it. A strip under each card has its
// notes and who asked, and opens it to manage.
//
// canEdit: owners and admins (add, edit, reorder, status). Managers see
// everything and log requests, which land in Ideas. The server checks the
// role again on every action.

const SHIPPED_SHOWN = 12;
const WEEK_MS = 7 * 86_400_000;

type Sheet = { kind: "item"; id: string } | { kind: "add" } | { kind: "log" };

function shippedAt(i: AdminRoadmapItem) {
  return i.shippedAt ?? i.statusChangedAt;
}

// The board's sections. Items arrive in rank order (the queue's order).
function sections(items: AdminRoadmapItem[]) {
  return {
    building: [...items.filter((i) => i.status === "building"), ...items.filter((i) => i.status === "reviewing")],
    queued: items.filter((i) => i.status === "queued"),
    ideas: items.filter((i) => i.status === "idea"),
    shipped: items.filter((i) => i.status === "live").sort((a, b) => shippedAt(b).localeCompare(shippedAt(a)) || a.rank - b.rank),
    notDoing: items.filter((i) => i.status === "not_doing"),
  };
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5 text-[15px] text-[var(--muted)]">{children}</p>;
}

export default function RoadmapManager({ items, canEdit, version, showVersions, now }: { items: AdminRoadmapItem[]; canEdit: boolean; version: string | null; showVersions: boolean; now: number }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [allShipped, setAllShipped] = useState(false);
  const open = (id: string) => setSheet({ kind: "item", id });
  const close = () => setSheet(null);

  const board = sections(items);
  const positions = new Map(board.queued.map((i, n) => [i.id, n + 1]));
  const shippedThisWeek = board.shipped.filter((i) => Date.parse(shippedAt(i)) >= now - WEEK_MS).length;
  const sheetItem = sheet?.kind === "item" ? items.find((i) => i.id === sheet.id) : undefined;
  const strip = (i: AdminRoadmapItem) => <StaffStrip item={i} canEdit={canEdit} onOpen={() => open(i.id)} />;
  const title = (i: AdminRoadmapItem) => <TitleButton title={i.title} onOpen={() => open(i.id)} />;
  const shippedList = allShipped ? board.shipped : board.shipped.slice(0, SHIPPED_SHOWN);

  return (
    <div className="max-w-5xl">
      <PageHeader
        area="guests"
        title="Roadmap"
        purpose={
          canEdit
            ? "What the crew is building, what's in line, the ideas and what's shipped. Staff only. Tap a card to move it along or edit it."
            : "What the crew is building, what's in line, the ideas and what's shipped. Staff only. Someone asked for something? Log it and it lands in Ideas."
        }
        actions={
          canEdit ? (
            <button type="button" onClick={() => setSheet({ kind: "add" })} className="btn-primary inline-flex min-h-11 items-center">
              + Add to the list
            </button>
          ) : (
            <button type="button" onClick={() => setSheet({ kind: "log" })} className="btn-primary inline-flex min-h-11 items-center">
              + Log someone&apos;s request
            </button>
          )
        }
      />

      <div className="@container space-y-12">
        <LiveBoard lastUpdate={lastChange(items)} now={now}>
          <BoardStat k="Building now" v={board.building.length} href="#building" />
          <BoardStat k="In line" v={board.queued.length} href="#up-next" />
          <BoardStat k="Ideas" v={board.ideas.length} href="#ideas" />
          <BoardStat k="Shipped this week" v={shippedThisWeek} href="#shipped" />
        </LiveBoard>

        <section id="building" aria-labelledby="building-h" className="scroll-mt-4">
          <SectionHead id="building-h" kicker="On the workbench" title="Building now" count={board.building.length} live={board.building.length > 0} />
          {board.building.length ? (
            <div className="grid gap-6 @2xl:grid-cols-2">
              {board.building.map((i) => (
                <BuildingCard key={i.id} item={boardItem(i)} now={now} title={title(i)} staff={strip(i)} />
              ))}
            </div>
          ) : (
            <Empty>Nothing on the workbench. Open something in Up next and move it to Building now.</Empty>
          )}
        </section>

        <section id="up-next" aria-labelledby="up-next-h" className="scroll-mt-4">
          <SectionHead id="up-next-h" kicker="The queue" title="Up next" count={board.queued.length}>
            {canEdit && board.queued.length > 1 && <p className="max-w-xs text-sm text-[var(--muted)]">Drag an item&apos;s ticket, or use the arrows, to change the order.</p>}
          </SectionHead>
          {board.queued.length ? <QueueList items={board.queued} canEdit={canEdit} now={now} onOpen={open} /> : <Empty>Nothing in line. Move an idea to In line and it joins the line.</Empty>}
        </section>

        <section id="ideas" aria-labelledby="ideas-h" className="scroll-mt-4">
          <SectionHead id="ideas-h" kicker="Being considered" title="Ideas" count={board.ideas.length} />
          {board.ideas.length ? (
            <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
              {board.ideas.map((i) => (
                <IdeaCard key={i.id} item={boardItem(i)} title={title(i)} staff={strip(i)} />
              ))}
            </div>
          ) : (
            <Empty>No ideas waiting. {canEdit ? "Add one with the status Idea." : "Log a request someone made and it lands here."}</Empty>
          )}
        </section>

        <section id="shipped" aria-labelledby="shipped-h" className="scroll-mt-4">
          <SectionHead id="shipped-h" kicker="Fresh off the press" title="Just shipped" count={board.shipped.length}>
            {version && (
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
              {shippedByDay(shippedList, shippedAt, (i) => releaseLabel(i.shippedInVersion)).map((d) => (
                <ShippedDay key={d.day} date={d.date} releases={d.releases}>
                  {d.items.map((i) => (
                    <ShippedRow
                      key={i.id}
                      item={boardItem(i)}
                      title={title(i)}
                      staff={<StaffStrip item={i} canEdit={canEdit} onOpen={() => open(i.id)} band={false} release={showVersions ? releaseLabel(i.shippedInVersion) : null} />}
                    />
                  ))}
                </ShippedDay>
              ))}
            </div>
          ) : (
            <Empty>Nothing shipped yet. Move an item to Live and it lands here.</Empty>
          )}
          {board.shipped.length > shippedList.length && (
            <button type="button" onClick={() => setAllShipped(true)} className="btn-secondary mt-6 min-h-11">
              Show everything shipped ({board.shipped.length})
            </button>
          )}
        </section>

        {board.notDoing.length > 0 && (
          <section id="not-planned" aria-label="Not planned" className="scroll-mt-4">
            <details className="group">
              <summary className="btn-secondary inline-flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="transition-transform group-open:rotate-90">
                  ›
                </span>
                Not planned ({board.notDoing.length})
              </summary>
              <p className="mt-3 text-sm text-[var(--muted)]">Decided against. Open one to bring it back.</p>
              <div className="sheet mt-4 !shadow-none">
                <ul className="divide-y divide-[var(--border)]">
                  {board.notDoing.map((i) => (
                    <ShippedRow
                      key={i.id}
                      item={boardItem(i)}
                      title={title(i)}
                      mark={
                        <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[var(--border)] bg-[var(--surface-hover)] text-xs font-bold text-[var(--muted)]">
                          ✕
                        </span>
                      }
                      staff={<StaffStrip item={i} canEdit={canEdit} onOpen={() => open(i.id)} band={false} />}
                    />
                  ))}
                </ul>
              </div>
            </details>
          </section>
        )}
      </div>

      {sheetItem && <ItemSheet key={sheetItem.id} item={sheetItem} position={positions.get(sheetItem.id) ?? null} canEdit={canEdit} showVersions={showVersions} now={now} onClose={close} />}

      {sheet?.kind === "add" && (
        <SideSheet title="Add to the list" subtitle="It starts in line; pick another status below if it's not a yes yet." onClose={close}>
          <ItemForm
            initial={{ title: "", summary: "", notes: "", status: "queued", requesterMemberId: null, requesterName: null }}
            requesterLabel={null}
            submitLabel="Add it"
            onSave={createRoadmapItem}
            onDone={close}
          />
        </SideSheet>
      )}

      {sheet?.kind === "log" && (
        <SideSheet title="Log someone's request" subtitle="Someone asked for something at the bar? It goes on the list as an idea for an owner or admin to look at." onClose={close}>
          <LogRequestForm onDone={close} />
        </SideSheet>
      )}
    </div>
  );
}
