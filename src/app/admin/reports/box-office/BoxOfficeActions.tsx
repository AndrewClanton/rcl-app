"use client";

import InfoTip from "@/components/help/InfoTip";

// Download the box office report as a spreadsheet (by movie, or one row per
// showing), or print it. The rows come ready-made from the page.

function csv(rows: string[][]) {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function download(filename: string, rows: string[][]) {
  // The byte-order mark tells Excel it's UTF-8 (titles with accents, dashes).
  const blob = new Blob(["﻿", csv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BoxOfficeActions({ name, byMovie, byShowing }: { name: string; byMovie: string[][]; byShowing: string[][] }) {
  const button = "h-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm font-semibold transition-colors hover:border-[var(--foreground)] disabled:opacity-40";
  const empty = byShowing.length <= 1;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 print:hidden">
      <button className={button} disabled={empty} onClick={() => download(`${name}_by-movie.csv`, byMovie)}>
        CSV by movie
      </button>
      <InfoTip topic="box-office-csv" className="!mx-0" />
      <button className={button} disabled={empty} onClick={() => download(`${name}_by-showing.csv`, byShowing)}>
        CSV by showing
      </button>
      <button className={button} onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}
