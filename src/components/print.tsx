import RegMark from "@/components/RegMark";

// The Royale print kit as components -- see the "print kit" block in
// globals.css for the rules (markup stays small, grey, monospace, and at
// corners and edges; never inline with a headline or copy).

export { RegMark };

const PLATES: [string, string][] = [
  ["var(--gold)", "Y"],
  ["var(--accent)", "R"],
  ["var(--foreground)", "K"],
  ["#fff", "W"],
];

// Press calibration strip: yellow, red, ink, white.
export function ColorBar({ codes = false, size = 11 }: { codes?: boolean; size?: number }) {
  if (codes) {
    return (
      <span className="colorbar-codes" aria-hidden="true">
        {PLATES.map(([c, k]) => (
          <span key={k}>
            <b style={{ background: c, width: size, height: size }} />
            {k}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="colorbar" aria-hidden="true">
      {PLATES.slice(0, 3).map(([c, k]) => (
        <i key={k} style={{ background: c, width: size, height: size }} />
      ))}
    </span>
  );
}

// A proof stamp. On an ink bar it prints yellow; `red` for light grounds.
export function ProofStamp({ children, red = false, className = "" }: { children: React.ReactNode; red?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={`proof-stamp ${red ? "proof-stamp-red" : ""} ${className}`}>
      {children}
    </span>
  );
}

// Leader line and a technical note (type, plate, spec).
export function Callout({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span aria-hidden="true" className={`callout ${className}`}>
      <i />
      {children}
    </span>
  );
}

// Registration mark with a note, for a corner of a Panel Pop piece.
export function RegNote({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div aria-hidden="true" className={`reg-note ${className}`}>
      <RegMark />
      <span>{children}</span>
    </div>
  );
}

// The bottom strip of a spec panel: color bar, then a sheet code.
export function SpecFoot({ code, className = "" }: { code: string; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2 ${className}`}>
      <ColorBar />
      <span className="spec-code">{code}</span>
    </div>
  );
}

export function Starburst({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`starburst-ink ${className}`}>
      <div className="starburst">{children}</div>
    </div>
  );
}

export function Seal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`seal ${className}`}>{children}</div>;
}

export function Sprockets({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`sprockets ${className}`} />;
}

// Page masthead: yellow eyebrow chip, the title with a spec callout beside
// it (wide screens), an optional intro, and a 3px ink rule ending in a
// color bar -- the top of every Four-Color Press page.
export function PageMasthead({
  eyebrow,
  title,
  intro,
  callout = "Archivo Black · K100",
  className = "",
}: {
  eyebrow: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  callout?: string;
  className?: string;
}) {
  return (
    <header className={`masthead-rule mb-10 pb-6 ${className}`}>
      <span className="page-eyebrow">{eyebrow}</span>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-4xl leading-none text-balance sm:text-5xl">{title}</h1>
        <Callout className="hidden md:inline-flex">{callout}</Callout>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        {intro ? <div className="max-w-2xl text-[15px] text-[var(--muted)]">{intro}</div> : <span />}
        <ColorBar codes />
      </div>
    </header>
  );
}
