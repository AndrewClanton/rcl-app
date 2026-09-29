import { ColorBar } from "@/components/print";

// The frame for the public site's "something's wrong" pages (the 404 and the
// error page): a spec panel with a strip of film across a yellow halftone
// band, the headline under it, then the plain-English explanation and the
// way out. No server-only imports, so the client error page can use it.
export default function ReelSheet({
  label,
  title,
  jammed = false,
  children,
  actions,
}: {
  label: string;
  title: React.ReactNode;
  jammed?: boolean;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="sheet crop">
        <div className="spec-head rounded-t-[4px]">
          <span>{label}</span>
        </div>
        <div className="halftone halftone-hero relative border-b-2 border-[var(--foreground)] bg-[var(--gold)] px-5 pt-10 pb-9 text-center sm:px-10 sm:pt-12 sm:pb-11">
          <div className="relative z-[1]">
            <FilmStrip jammed={jammed} />
            <h1 className="font-display mx-auto mt-9 max-w-xl text-4xl leading-[0.98] text-balance sm:text-6xl">{title}</h1>
          </div>
        </div>
        <div className="px-5 py-6 sm:px-8 sm:py-7">
          <div className="max-w-xl space-y-3 text-[15px] sm:text-base">{children}</div>
          <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>
        </div>
        <div className="border-t border-[var(--border)] px-4 py-2">
          <ColorBar />
        </div>
      </section>
    </div>
  );
}

// Three frames of film between two rows of perforations. The middle frame
// is empty (a missing reel) or burnt through (a jammed projector).
function FilmStrip({ jammed }: { jammed: boolean }) {
  const perfs = { backgroundImage: "repeating-linear-gradient(90deg, var(--background) 0 9px, transparent 9px 17px)" };
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[20rem] -rotate-2 rounded-[4px] border-[3px] border-[var(--foreground)] bg-[var(--foreground)] px-2 py-1.5 shadow-[5px_5px_0_var(--accent)] sm:max-w-sm"
    >
      <div className="h-2.5 rounded-[1px]" style={perfs} />
      <div className="grid grid-cols-3 gap-2 py-2">
        <div className="aspect-[4/3] rounded-[2px] bg-[var(--accent)]" />
        {jammed ? (
          <div
            className="aspect-[4/3] rounded-[2px]"
            style={{ background: "radial-gradient(circle at 50% 55%, var(--background) 0 18%, var(--gold) 30%, var(--accent) 52%, var(--foreground) 74%)" }}
          />
        ) : (
          <div className="aspect-[4/3] rounded-[2px] border-2 border-dashed border-[rgba(248,245,236,0.6)]" />
        )}
        <div className="aspect-[4/3] rounded-[2px] bg-[var(--background)]" />
      </div>
      <div className="h-2.5 rounded-[1px]" style={perfs} />
    </div>
  );
}
