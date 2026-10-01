"use client";

import { useRef, useState } from "react";
import type { AdminRoadmapItem } from "@/lib/data/roadmap";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { QUEUE_TICKET, QueueCard } from "@/components/roadmap/board";
import { reorderRoadmap } from "./actions";
import { LockIcon, STAFF_ONLY_GROUND, StaffStrip, TitleButton, VoteTally, boardItem } from "./staff";

// Up next, in line order, drawn like What's new's queue. Owners and admins
// reorder it by dragging an item's ticket (the gold #number), or with the
// arrows one step at a time.
//
// Pointer events, so a finger on the iPad drags as well as a mouse: press
// the ticket, move, let go. The rows part to show where it will land; on
// release only the items whose rank changed are saved.

const PRIVATE_TICKET =
  "grid h-14 w-14 place-items-center rounded-[4px] border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] text-[var(--muted)] sm:h-16 sm:w-16";

export default function QueueList({ items, canEdit, now, onOpen }: { items: AdminRoadmapItem[]; canEdit: boolean; now: number; onOpen: (id: string) => void }) {
  const key = items.map((i) => `${i.id}:${i.rank}`).join(",");
  const [seenKey, setSeenKey] = useState(key);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  if (seenKey !== key) {
    // Fresh data from the server: it has the saved order now.
    setSeenKey(key);
    setLocalOrder(null);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = (localOrder ?? items.map((i) => i.id)).filter((id) => byId.has(id));
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [drag, setDrag] = useState<{ id: string; pointerId: number; startY: number; dy: number; tops: number[]; heights: number[]; gap: number } | null>(null);
  const [, run] = useRefreshingAction();

  function save(next: string[]) {
    // Keep the ranks the queue already uses, in the new order (so only the
    // moved items change), unless two share a rank: then number them 1, 2, 3.
    const current = order.map((id) => byId.get(id)!.rank);
    const sorted = [...current].sort((a, b) => a - b);
    const distinct = new Set(sorted).size === sorted.length && sorted.every((r) => r > 0);
    const ranks = distinct ? sorted : sorted.map((_, i) => i + 1);
    const changes = next.map((id, i) => ({ id, rank: ranks[i] })).filter((c) => byId.get(c.id)!.rank !== c.rank);
    setLocalOrder(next);
    if (changes.length) run(() => reorderRoadmap(changes));
  }

  function targetIndex(d: NonNullable<typeof drag>): number {
    const from = order.indexOf(d.id);
    const center = d.tops[from] + d.heights[from] / 2 + d.dy;
    let t = 0;
    for (let i = 0; i < order.length; i++) {
      if (i === from) continue;
      if (d.tops[i] + d.heights[i] / 2 < center) t++;
    }
    return t;
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!canEdit || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const tops: number[] = [];
    const heights: number[] = [];
    for (const rid of order) {
      const r = rows.current.get(rid)?.getBoundingClientRect();
      tops.push((r?.top ?? 0) + window.scrollY);
      heights.push(r?.height ?? 0);
    }
    const gap = order.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0;
    setDrag({ id, pointerId: e.pointerId, startY: e.clientY + window.scrollY, dy: 0, tops, heights, gap });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // Near the top or bottom of the screen, scroll so a long queue can be
    // dragged end to end.
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    setDrag({ ...drag, dy: e.clientY + window.scrollY - drag.startY });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const from = order.indexOf(drag.id);
    const to = targetIndex(drag);
    setDrag(null);
    if (from === to || from < 0) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, drag.id);
    save(next);
  }

  function move(id: string, dir: -1 | 1) {
    const from = order.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save(next);
  }

  const from = drag ? order.indexOf(drag.id) : -1;
  const to = drag ? targetIndex(drag) : -1;
  // "#3 in line" counts public items only, the way What's new numbers them.
  const publicPositions = new Map<string, number>();
  for (const id of order) if (byId.get(id)!.isPublic) publicPositions.set(id, publicPositions.size + 1);

  const arrow = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--foreground)] disabled:opacity-30";

  return (
    <>
      <ol className="space-y-4" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
        {order.map((id, i) => {
          const item = byId.get(id)!;
          const position = publicPositions.get(id) ?? null;
          let shift = 0;
          if (drag && i !== from) {
            const h = drag.heights[from] + drag.gap;
            if (from < to && i > from && i <= to) shift = -h;
            if (from > to && i >= to && i < from) shift = h;
          }
          const dragging = drag?.id === id;
          const face = item.isPublic ? (
            <span className={QUEUE_TICKET}>#{position}</span>
          ) : (
            <span className={PRIVATE_TICKET}>
              <LockIcon className="h-5 w-5" />
            </span>
          );
          const ticket = canEdit ? (
            <button
              type="button"
              onPointerDown={(e) => onPointerDown(e, id)}
              className="flex w-14 shrink-0 cursor-grab touch-none flex-col items-center self-start select-none active:cursor-grabbing sm:w-16"
              aria-label={`Drag to reorder ${item.title}`}
              title="Drag to reorder"
            >
              {face}
              <span className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-[var(--muted)] uppercase">
                <span aria-hidden>⠿ </span>Drag
              </span>
            </button>
          ) : (
            <div className="flex w-14 shrink-0 flex-col items-center sm:w-16">
              {face}
              <span className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-[var(--muted)] uppercase">{item.isPublic ? "in line" : "staff"}</span>
            </div>
          );
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) rows.current.set(id, el);
                else rows.current.delete(id);
              }}
              style={{
                transform: dragging ? `translateY(${drag.dy}px)` : shift ? `translateY(${shift}px)` : undefined,
                transition: dragging ? "none" : "transform 150ms",
                position: "relative",
                zIndex: dragging ? 20 : undefined,
              }}
            >
              <QueueCard
                item={boardItem(item, position)}
                now={now}
                title={<TitleButton title={item.title} onOpen={() => onOpen(id)} />}
                vote={item.isPublic || item.votes ? <VoteTally votes={item.votes} live={false} /> : null}
                ticket={ticket}
                className={`${item.isPublic ? "" : `border-dashed ${STAFF_ONLY_GROUND}`} ${dragging ? "shadow-[6px_8px_0_var(--foreground)]" : item.isPublic ? "" : "shadow-none"}`}
                staff={
                  <StaffStrip item={item} canEdit={canEdit} onOpen={() => onOpen(id)}>
                    {canEdit && order.length > 1 && (
                      <>
                        <button type="button" onClick={() => move(id, -1)} disabled={i === 0} className={arrow} aria-label={`Move ${item.title} up`}>
                          ▲
                        </button>
                        <button type="button" onClick={() => move(id, 1)} disabled={i === order.length - 1} className={arrow} aria-label={`Move ${item.title} down`}>
                          ▼
                        </button>
                      </>
                    )}
                  </StaffStrip>
                }
              />
            </li>
          );
        })}
      </ol>
      {order.length > 0 && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          The gold number is its place in line on What&apos;s new. Staff-only items (the lock) don&apos;t get one, so the public line never skips a number.
        </p>
      )}
    </>
  );
}
