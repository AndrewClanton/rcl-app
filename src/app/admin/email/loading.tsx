// Shown the moment Email (or any of its tabs, or a shortcut to it) is
// tapped. Every Email page is drawn fresh on the server from several
// lookups, and without this the tap showed nothing at all until all of
// them were done, so it looked like the link didn't work.
export default function EmailLoading() {
  const block = "animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]";
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Opening Email">
      <div className="space-y-3">
        <div className="h-4 w-28 animate-pulse rounded bg-[var(--surface)]" />
        <div className="h-11 w-40 animate-pulse rounded bg-[var(--surface)]" />
        <p className="text-sm text-[var(--muted)]">Opening Email…</p>
      </div>
      <div className={`${block} h-40`} />
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:gap-4">
        <div className={`${block} h-24 sm:h-56`} />
        <div className={`${block} h-24 sm:h-56`} />
        <div className={`${block} h-24 sm:h-56`} />
      </div>
    </div>
  );
}
