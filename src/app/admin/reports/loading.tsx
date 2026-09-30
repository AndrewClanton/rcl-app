// Shown the moment a report tab or arrow is tapped, while its numbers load.
export default function ReportsLoading() {
  const block = "animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]";
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the report">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-full bg-[var(--surface)]" />
        <div className="mx-auto h-7 w-48 animate-pulse rounded bg-[var(--surface)]" />
        <div className="h-11 w-11 animate-pulse rounded-full bg-[var(--surface)]" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`${block} col-span-2 h-28`} />
        <div className={`${block} h-28`} />
        <div className={`${block} h-28`} />
      </div>
      <div className={`${block} h-48`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${block} h-64`} />
        <div className={`${block} h-64`} />
      </div>
    </div>
  );
}
