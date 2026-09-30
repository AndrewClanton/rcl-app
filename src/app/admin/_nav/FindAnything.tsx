"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NavBadges } from "@/lib/data/backoffice";
import type { FindEntry } from "./map";
import Badge from "./Badge";
import { CloseIcon, SearchIcon } from "./icons";

// Find anything: type a few letters of what you want ("hours", "86", "tax",
// "flyer") and jump there. Also finds an order by its number ("7851") and
// searches members by name, email or phone. Opens from the menu, with
// Ctrl+K / Cmd+K, or with "/" when you're not typing in a box.

type Row = FindEntry & { key: string };

function words(s: string) {
  return s.toLowerCase().split(/[^a-z0-9#+&']+/).filter(Boolean);
}

function rank(entries: FindEntry[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  const rows = entries.map((e, i) => ({ ...e, key: `${i}:${e.href}` }));
  if (!q) return rows;
  const want = q.split(/\s+/);
  const scored: { row: Row; score: number; i: number }[] = [];
  rows.forEach((row, i) => {
    const label = row.label.toLowerCase();
    const hay = `${label} ${row.keywords ?? ""} ${row.group} ${row.about}`.toLowerCase();
    if (!want.every((w) => hay.includes(w))) return;
    const labelWords = words(row.label);
    const keyWords = words(row.keywords ?? "");
    let score = label.startsWith(q) ? 100 : label.includes(q) ? 60 : 0;
    for (const w of want) {
      if (labelWords.some((t) => t.startsWith(w))) score += 15;
      else if (keyWords.some((t) => t.startsWith(w))) score += 8;
    }
    scored.push({ row, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.row);
}

// Jumps that depend on what was typed: an order number, or a member search.
function extras(query: string): { first: Row[]; last: Row[] } {
  const q = query.trim();
  const order = /^#?\s*(\d{1,12})$/.exec(q);
  const first: Row[] = order
    ? [{ key: "order", href: `/admin/reports?order=${order[1]}`, label: `Find order #${order[1]}`, about: "Reports → Day, opened to that order.", group: "Money & reports", area: "money" }]
    : [];
  const last: Row[] =
    q.length >= 2 && !order
      ? [{ key: "members", href: `/admin/members?q=${encodeURIComponent(q)}`, label: `Search members for “${q}”`, about: "By name, email or phone.", group: "Guests & members", area: "guests" }]
      : [];
  return { first, last };
}

export default function FindAnything({ entries, badges, onClose }: { entries: FindEntry[]; badges: NavBadges; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const { first, last } = extras(query);
    return [...first, ...rank(entries, query), ...last];
  }, [entries, query]);
  const grouped = !query.trim();

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[sel]) {
      e.preventDefault();
      go(results[sel].href);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[8vh] print:hidden" role="dialog" aria-modal="true" aria-label="Find anything" onKeyDown={onKey}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <span className="text-[var(--muted)]">
            <SearchIcon />
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            placeholder="Find a page, a report, an order number, a member…"
            aria-label="Find anything"
            aria-controls="find-results"
            aria-activedescendant={results[sel] ? `find-row-${sel}` : undefined}
            className="min-h-14 min-w-0 flex-1 bg-transparent text-base outline-none"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-hover)]">
            <CloseIcon />
          </button>
        </div>
        <ul id="find-results" ref={list} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">Nothing by that name. Try another word.</li>}
          {results.map((r, i) => {
            const heading = grouped && (i === 0 || results[i - 1].group !== r.group);
            return (
              <li key={r.key} className={r.area ? `bo-area-${r.area}` : ""}>
                {heading && <div className="bo-eyebrow px-3 pb-1 pt-3">{r.area ? <span className="bo-dot" /> : null}{r.group}</div>}
                <Link
                  id={`find-row-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={i === sel}
                  href={r.href}
                  onClick={onClose}
                  onMouseMove={() => i !== sel && setSel(i)}
                  className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 ${i === sel ? "bg-[var(--surface-hover)]" : ""}`}
                >
                  {r.area ? <span className="bo-dot" /> : <span className="bo-dot !bg-[var(--border)]" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{r.label}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">{r.about}</span>
                  </span>
                  {r.badge && <Badge badge={badges[r.badge]} />}
                  {!grouped && <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">{r.group}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)] md:block">↑ ↓ to move · Enter to open · Esc to close · Ctrl K opens this from any page</div>
      </div>
    </div>
  );
}
