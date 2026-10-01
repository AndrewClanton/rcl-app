"use client";

import { useEffect, useRef, useState } from "react";
import {
  creditLine,
  isFound,
  previewUrl,
  SOURCE_NAMES,
  type CandidateView,
  type FoundSource,
  type PictureResult,
  type PictureState,
  type SearchResult,
} from "@/lib/menu-pictures/shared";

// Browsing free-to-use pictures for a register button or tab: one at a time,
// big enough to judge on an iPad, with ◀ ▶ to go through the results, its
// credit under it, and other words to Try again with. Use this picture has
// the server download it and put it on the button; nothing here is loaded
// from another site (previews come from /api/menu-pictures/preview).
//
// Shared by the register's item settings and Back office → Menu, which
// hand in their own `find` and `pick` (each checks who's asking its own way).
//
// Pixabay and Pexels ask to be named wherever their pictures are shown, and
// Pexels's photographers credited with a link: both are under the picture,
// and the libraries that answered a search are listed at the bottom.

type Found = { query: string; candidates: CandidateView[]; sources: FoundSource[] };

// The libraries' own sites, for the links they ask for.
const HOME: Partial<Record<FoundSource, string>> = { pixabay: "https://pixabay.com/", pexels: "https://www.pexels.com/" };

function SourceName({ source }: { source: FoundSource }) {
  const home = HOME[source];
  if (!home) return <>{SOURCE_NAMES[source]}</>;
  return (
    <a className="underline" href={home} target="_blank" rel="noopener noreferrer">
      {SOURCE_NAMES[source]}
    </a>
  );
}

// "Pixabay, Pexels and Openverse"
function SourceList({ sources }: { sources: FoundSource[] }) {
  return sources.map((s, i) => (
    <span key={s}>
      {i > 0 && (i === sources.length - 1 ? " and " : ", ")}
      <SourceName source={s} />
    </span>
  ));
}

export default function PicturePicker({
  current,
  find,
  pick,
  onPicked,
  onCancel,
  pickLabel = "Use this picture",
}: {
  current: PictureState;
  find: (query: string | null) => Promise<SearchResult>;
  pick: (query: string, index: number, page: string | null) => Promise<PictureResult>;
  onPicked: (picture: PictureState) => void;
  onCancel: () => void;
  pickLabel?: string;
}) {
  const [found, setFound] = useState<Found | null>(null);
  const [at, setAt] = useState(0);
  const [words, setWords] = useState(isFound(current.image_source) ? (current.image_query ?? "") : "");
  const [busy, setBusy] = useState<"search" | "pick" | null>("search");
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const started = useRef(false);

  async function search(query: string | null) {
    setBusy("search");
    setError(null);
    try {
      const r = await find(query);
      if (!r.ok) return setError(r.error);
      setFound({ query: r.query, candidates: r.candidates, sources: r.sources ?? [] });
      setWords(r.query);
      setBroken(new Set());
      // Looking again at the same search starts on the next one along: the
      // one on the button is what they want to replace. Found by its page
      // (a picture found on its own came from a list without Pixabay), else
      // by its place.
      const same = isFound(current.image_source) && current.image_query === r.query;
      const page = current.image_credit?.page;
      const on = same && page ? r.candidates.findIndex((c) => c.credit.page === page) : -1;
      setAt(on >= 0 ? (on + 1) % r.candidates.length : same && current.image_index !== null ? (current.image_index + 1) % r.candidates.length : 0);
    } catch {
      setError("The picture search didn't answer. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void search(isFound(current.image_source) ? current.image_query : null);
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = found?.candidates.length ?? 0;
  const shown = found ? found.candidates[at] : null;

  // The next one loads while this one's being looked at, so ▶ is instant.
  useEffect(() => {
    if (!found || n < 2) return;
    const img = new window.Image();
    const next = (at + 1) % n;
    img.src = previewUrl(found.query, next, found.candidates[next].credit.page);
  }, [found, at, n]);

  function step(d: number) {
    if (!n) return;
    setError(null);
    setAt((i) => (i + d + n) % n);
  }

  async function use() {
    if (!found || !shown) return;
    setBusy("pick");
    setError(null);
    try {
      const r = await pick(found.query, at, shown.credit.page);
      if (!r.ok) return setError(r.error);
      onPicked(r.picture);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const typed = words.replace(/\s+/g, " ").trim();
  const credit = shown ? creditLine(shown.source, shown.credit) : null;
  const arrow = "btn-secondary min-h-12 min-w-12 !px-0 !text-xl";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" className={arrow} disabled={n < 2 || !!busy} onClick={() => step(-1)} aria-label="Previous picture">
          ◀
        </button>
        <div className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}>
          {found && shown && !broken.has(at) && (
            // Our own server's preview of result `at`; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${found.query}#${at}`}
              src={previewUrl(found.query, at, shown.credit.page)}
              alt={shown.credit.title ?? "Picture"}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setBroken((b) => new Set(b).add(at))}
            />
          )}
          {found && broken.has(at) && (
            <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm" style={{ color: "var(--muted)" }}>
              This one won&apos;t load. Try ▶.
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-bold text-white">{busy === "search" ? "Looking…" : "Saving…"}</div>
          )}
          {!busy && !found && error && (
            <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm" style={{ color: "var(--muted)" }}>
              No pictures yet
            </div>
          )}
        </div>
        <button type="button" className={arrow} disabled={n < 2 || !!busy} onClick={() => step(1)} aria-label="Next picture">
          ▶
        </button>
      </div>

      {shown && (
        <div className="text-center text-xs leading-snug" style={{ color: "var(--muted)" }}>
          <span className="font-bold tabular-nums">
            {at + 1} of {n}
          </span>
          {credit && (
            <>
              {" · "}
              {/* The credit links to the picture's own page ("Photo by Jane on Pexels"). */}
              {shown.credit.page ? (
                <a className="underline" href={shown.credit.page} target="_blank" rel="noopener noreferrer">
                  {credit} ↗
                </a>
              ) : (
                credit
              )}
            </>
          )}
          {shown.source === "pexels" && (
            <>
              {" · "}
              <a className="font-bold underline" href="https://www.pexels.com/" target="_blank" rel="noopener noreferrer">
                Photos provided by Pexels
              </a>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-12 flex-1 !text-base" disabled={!shown || broken.has(at) || !!busy} onClick={use}>
          {pickLabel}
        </button>
        <button type="button" className="btn-secondary min-h-12 !text-base" disabled={busy === "pick"} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typed || busy) return;
          // The same words again: the next picture along.
          if (found && typed.toLowerCase() === found.query) step(1);
          else void search(typed);
        }}
      >
        <input
          className="input min-w-0 flex-1 !py-2.5 !text-base"
          value={words}
          maxLength={80}
          placeholder="Other words, e.g. nachos cheese"
          aria-label="What to search for"
          onChange={(e) => setWords(e.target.value)}
        />
        <button type="submit" className="btn-secondary min-h-11" disabled={!typed || !!busy}>
          Try again
        </button>
      </form>

      {error && (
        <p className="text-sm font-bold" style={{ color: "var(--danger-text)" }} role="status">
          {error}
        </p>
      )}
      <p className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
        Only pictures free for a business to use
        {found && found.sources.length > 0 ? (
          <>
            , from <SourceList sources={found.sources} />
          </>
        ) : null}
        . The one you pick is copied to our own server.
      </p>
    </div>
  );
}
