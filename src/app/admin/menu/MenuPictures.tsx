"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory } from "@/lib/types";
import MenuPicture from "@/components/menu/MenuPicture";
import PicturePicker from "@/components/menu/PicturePicker";
import { creditLine, isFound, pictureOf, textIconShown, type PhotoTarget, type PictureState } from "@/lib/menu-pictures/shared";
import { fillMenuPictures, findMenuPictures, keepMenuPicture, pickMenuPicture, removeMenuPhoto } from "./actions";

// Pictures for the whole register, for managers, above the categories:
//   - Find pictures for everything: every button with no picture
//     (and nobody's decision to leave it as its label or give it a text
//     icon) gets a free-to-use one, a few at a time, with progress.
//   - Photo walk: the pictures found automatically, one at a time, big:
//     Keep, Find a better one (◀ ▶), Use label tile, or Skip.

interface Entry {
  target: PhotoTarget;
  id: string;
  name: string;
  category: string | null; // for its label tile's color
  parent: string | null;
  where: string; // "Alcohol → Beer", shown on the walk
  picture: PictureState;
}

// Item buttons only: category tabs show an icon (components/menu/CategoryIcon).
function entriesOf(categories: MenuCategory[]): Entry[] {
  const out: Entry[] = [];
  for (const c of categories) {
    for (const i of c.items) if (i.active) out.push({ target: "item", id: i.id, name: i.name, category: c.label, parent: null, where: c.label, picture: pictureOf(i) });
    for (const s of c.subcategories) {
      for (const i of s.items) if (i.active) out.push({ target: "item", id: i.id, name: i.name, category: s.label, parent: c.label, where: `${c.label} → ${s.label}`, picture: pictureOf(i) });
    }
  }
  return out;
}

type Fill = { done: number; failed: string[]; running: boolean };

export default function MenuPictures({ categories }: { categories: MenuCategory[] }) {
  const router = useRouter();
  const all = useMemo(() => entriesOf(categories), [categories]);
  const missing = all.filter((e) => !e.picture.image_url && !e.picture.image_source).length;
  const unchecked = all.filter((e) => !!e.picture.image_url && isFound(e.picture.image_source) && !e.picture.image_approved_at);
  const [fill, setFill] = useState<Fill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walk, setWalk] = useState<Entry[] | null>(null);

  async function fillAll() {
    const skip: string[] = [];
    const failed: string[] = [];
    let done = 0;
    setError(null);
    setFill({ done, failed, running: true });
    try {
      // A few per call; stops when there's nothing left it hasn't tried.
      for (let round = 0; round < 80; round++) {
        const r = await fillMenuPictures(skip);
        if (!r.ok) {
          setError(r.error);
          break;
        }
        for (const l of r.report.lines) {
          if (l.ok) done++;
          else {
            skip.push(l.id);
            failed.push(`${l.name} (${l.error})`);
          }
        }
        setFill({ done, failed: [...failed], running: true });
        router.refresh();
        if (r.report.left === 0 || r.report.lines.length === 0) break;
      }
    } catch {
      setError("The connection dropped. Press it again to carry on where it stopped.");
    } finally {
      setFill({ done, failed: [...failed], running: false });
      router.refresh();
    }
  }

  const covered = all.length - missing;
  return (
    <section className="mb-5 rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Register pictures</div>
          <div className="text-xs text-[var(--muted)]">
            {covered} of {all.length} buttons have a picture, a text icon or a chosen label
            {missing > 0 && `; ${missing} still show just their label`}.
            {unchecked.length > 0 && ` ${unchecked.length} found automatically and not checked yet.`}
          </div>
        </div>
        {unchecked.length > 0 && (
          <button className="btn-primary min-h-11 !text-sm" disabled={fill?.running} onClick={() => setWalk(unchecked)}>
            Photo walk ({unchecked.length})
          </button>
        )}
        {missing > 0 && (
          <button className="btn-secondary min-h-11 !text-sm" disabled={fill?.running} onClick={fillAll}>
            {fill?.running ? `Finding… ${fill.done} done` : "Find pictures for everything"}
          </button>
        )}
      </div>
      {fill && !fill.running && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Found {fill.done} {fill.done === 1 ? "picture" : "pictures"}.
          {fill.failed.length > 0 && ` No picture for ${fill.failed.join(", ")}: those show their label; use Find picture on them to try other words.`}
          {fill.done > 0 && " Check them on the Photo walk."}
        </p>
      )}
      {error && <p className="mt-2 text-xs font-bold text-[var(--danger-text)]">{error}</p>}
      {walk && (
        <PhotoWalk
          queue={walk}
          onClose={() => {
            setWalk(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

// One picture at a time, big enough to judge.
function PhotoWalk({ queue, onClose }: { queue: Entry[]; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(0);
  const e = queue[at] ?? null;

  function next() {
    setFinding(false);
    setError(null);
    setAt((i) => i + 1);
  }

  async function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, count = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      if (count) setKept((k) => k + 1);
      next();
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const credit = e ? creditLine(e.picture.image_source, e.picture.image_credit) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="Photo walk">
      <div className="card w-full max-w-md shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">
              Photo walk · {Math.min(at + 1, queue.length)} of {queue.length}
            </div>
            <h2 className="font-display text-2xl leading-tight">{e ? e.name : "All checked"}</h2>
            {e && <div className="text-xs text-[var(--muted)]">{e.where}</div>}
          </div>
          <button className="btn-secondary min-h-11 shrink-0" onClick={onClose}>
            {e ? "Stop" : "Done"}
          </button>
        </div>

        {!e ? (
          <p className="text-sm">
            That&apos;s every picture that was found automatically. {kept > 0 && `${kept} kept as they were.`} Anything you skipped is still waiting for next time.
          </p>
        ) : finding ? (
          <PicturePicker
            key={e.id}
            current={e.picture}
            find={(q) => findMenuPictures(e.target, e.id, q)}
            pick={(q, i, page) => pickMenuPicture(e.target, e.id, q, i, page)}
            onPicked={next}
            onCancel={() => setFinding(false)}
            pickLabel="Use this one"
          />
        ) : (
          <div className="space-y-3">
            <div className="relative mx-auto aspect-square w-full max-w-72 overflow-hidden rounded-lg border border-[var(--border)]">
              <MenuPicture url={e.picture.image_url} text={textIconShown(e.picture)} name={e.name} category={e.category} parent={e.parent} sizes="288px" className="h-full w-full" />
            </div>
            {credit && <p className="text-center text-[11px] leading-snug text-[var(--muted)]">{credit}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary min-h-12 !text-base" disabled={busy} onClick={() => act(() => keepMenuPicture(e.target, e.id), true)}>
                Keep
              </button>
              <button className="btn-secondary min-h-12 !text-base" disabled={busy} onClick={() => setFinding(true)}>
                Find a better one
              </button>
              <button className="btn-secondary min-h-12 !text-sm" disabled={busy} onClick={() => act(() => removeMenuPhoto(e.target, e.id))}>
                Use label tile
              </button>
              <button className="min-h-12 text-sm text-[var(--muted)] hover:underline" disabled={busy} onClick={next}>
                Skip for now
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm font-bold text-[var(--danger-text)]">{error}</p>}
      </div>
    </div>
  );
}
