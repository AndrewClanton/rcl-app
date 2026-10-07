// Shown the moment an email is tapped (a card, Up next, a new draft), while
// the server loads it, its audience and its showtimes.
export default function EmailEditorLoading() {
  const block = "animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]";
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Opening the email">
      <div className="space-y-2">
        <div className="h-9 w-56 max-w-full animate-pulse rounded bg-[var(--surface)]" />
        <p className="text-sm text-[var(--muted)]">Opening the email…</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-5">
          <div className={`${block} h-48`} />
          <div className={`${block} h-80`} />
        </div>
        <div className={`${block} hidden h-[600px] xl:block`} />
      </div>
    </div>
  );
}
