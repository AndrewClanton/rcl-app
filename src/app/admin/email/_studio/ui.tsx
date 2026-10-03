// The Email pages' small shared pieces (Royale Email Studio): a thumbnail
// of an email, a status chip, the step track and a progress bar. No
// browser code, so server and client components can both use them.

// An email's top, as our emails start: the ink band with its label (gold),
// its headline (the last word red, as the ready-made designs set it) and
// its first line. Built from the email's own words (data.ts thumbOf).
export interface Thumb {
  kicker: string;
  head: string; // the headline, less the accent word
  accent: string | null; // the red word, with what follows it ("here", ".")
  tail: string;
  lede: string | null;
}

function Headline({ t }: { t: Thumb }) {
  return (
    <>
      {t.head}
      {t.accent ? (
        <>
          {" "}
          <span className="text-[#ff4a50]">{t.accent}</span>
          {t.tail}
        </>
      ) : null}
    </>
  );
}

// "card": the band on a campaign card. "hero": the tilted email on the
// gold Up next panel, with what the inbox shows under it. "tile": a square
// with the label's first letter, for a phone's list.
export function EmailThumb({ thumb, size = "card", subject, preheader }: { thumb: Thumb; size?: "card" | "hero" | "tile"; subject?: string; preheader?: string | null }) {
  if (size === "tile") {
    return (
      <span aria-hidden="true" className="font-display inline-flex h-13 w-13 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-xl text-[var(--gold)]">
        {(thumb.head.trim()[0] ?? "R").toUpperCase()}
      </span>
    );
  }
  if (size === "hero") {
    return (
      <div aria-hidden="true" className="w-full max-w-[300px] -rotate-2 overflow-hidden rounded-2xl bg-[var(--background)] shadow-[0_18px_40px_rgba(20,17,12,0.28)]">
        <div className="flex flex-col gap-2 bg-[var(--foreground)] px-[18px] pb-[22px] pt-4">
          <div className="flex items-center gap-2">
            <span className="font-display inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#ed1c24] text-[13px] text-white">r</span>
            <span className="font-mono text-[9px] tracking-[0.16em] text-[var(--background)]">ROYALE CINEMA LOUNGE</span>
          </div>
          <span className="mt-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--gold)]">{thumb.kicker}</span>
          <span className="font-display text-[28px] leading-[1.02] text-[var(--background)]">
            <Headline t={thumb} />
          </span>
          {thumb.lede && <span className="text-xs text-[#d9d2bf]">{thumb.lede}</span>}
        </div>
        {(subject || preheader) && (
          <div className="flex flex-col gap-1.5 px-[18px] pb-5 pt-4">
            {subject && <span className="font-display text-[15px] leading-tight">{subject}</span>}
            {preheader && <span className="text-[11px] leading-[1.45] text-[#4a4336]">{preheader}</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex min-h-[118px] flex-col gap-1.5 bg-[var(--foreground)] px-[18px] pb-5 pt-4">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--gold)]">{thumb.kicker}</span>
      <span className="font-display text-[22px] leading-[1.05] text-[var(--background)]">
        <Headline t={thumb} />
      </span>
    </div>
  );
}

export type ChipTone = "sent" | "ready" | "going" | "paused" | "stopped" | "draft" | "scheduled" | "off";

const CHIP: Record<ChipTone, string> = {
  sent: "bg-[var(--success-bg)] text-[var(--success-text)]",
  ready: "bg-[var(--gold)] text-[var(--foreground)]",
  going: "bg-[var(--foreground)] text-[var(--background)]",
  paused: "bg-[var(--warn-bg)] text-[var(--warn-text)] ring-1 ring-inset ring-[var(--warn-border)]",
  stopped: "bg-[var(--surface)] text-[var(--accent-hover)] ring-1 ring-inset ring-[var(--accent-hover)]",
  draft: "bg-[#f1ecdd] text-[#4a4336]",
  scheduled: "bg-[var(--surface)] text-[var(--foreground)] ring-1 ring-inset ring-[var(--foreground)]",
  off: "bg-[var(--surface-hover)] text-[var(--muted)]",
};

export function StatusChip({ label, tone }: { label: string; tone: ChipTone }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.04em] ${CHIP[tone]}`}>{label}</span>;
}

// One step of an email's way out: done, where it is now, something to look
// at, not yet, or only a suggestion (the dashed bar).
export type StepState = "done" | "current" | "attention" | "todo" | "tip";
export interface Step {
  label: string;
  sub: string;
  state: StepState;
}

const STATE_WORD: Record<StepState, string> = { done: "Done", current: "You're here", attention: "Needs a look", todo: "Not yet", tip: "Suggested" };

function Bar({ state }: { state: StepState }) {
  const cls =
    state === "done"
      ? "bg-[var(--foreground)]"
      : state === "current" || state === "attention"
        ? "bg-[var(--accent-hover)]"
        : state === "tip"
          ? "border-2 border-dashed border-[rgba(20,17,12,0.45)]"
          : "bg-[rgba(20,17,12,0.2)]";
  return <span aria-hidden="true" className={`block h-1.5 rounded-full ${cls}`} />;
}

// The five steps with their words (sm and up). Made for the gold panel:
// the small type is the dark brown that reads on gold.
export function StepTrack({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="grid list-none grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-x-2 gap-y-3 p-0">
      {steps.map((s, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-2" aria-current={s.state === "current" || s.state === "attention" ? "step" : undefined}>
          <Bar state={s.state} />
          <span className="text-[13px] font-bold leading-tight">{s.label}</span>
          <span className="text-xs text-[#3d3528]">
            <span className="sr-only">{STATE_WORD[s.state]}: </span>
            {s.sub}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The same, as five bars and one line, for a phone.
export function CompactTrack({ steps }: { steps: Step[] }) {
  const at = steps.findIndex((s) => s.state === "current" || s.state === "attention");
  const here = at >= 0 ? steps[at] : null;
  const allDone = steps.every((s) => s.state === "done" || s.state === "tip");
  return (
    <div className="space-y-1.5">
      <div aria-hidden="true" className="grid grid-cols-5 gap-1.5">
        {steps.map((s, i) => (
          <Bar key={i} state={s.state} />
        ))}
      </div>
      <p className="text-sm text-[#3d3528]">
        {here ? (
          <>
            Step {at + 1} of {steps.length}: <strong className="text-[var(--foreground)]">{here.label}</strong> · {here.sub}
          </>
        ) : allDone ? (
          `All ${steps.length} steps done`
        ) : (
          `${steps.filter((s) => s.state === "done").length} of ${steps.length} steps done`
        )}
      </p>
    </div>
  );
}

// How much of an email has gone: sent of everyone it's for.
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div role="img" aria-label={label} className="h-1.5 overflow-hidden rounded-full bg-[#f1ecdd]">
      <div className="h-1.5 rounded-full bg-[var(--foreground)]" style={{ width: `${pct}%` }} />
    </div>
  );
}
