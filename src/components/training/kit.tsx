import s from "./kit.module.css";

// Building blocks for the picture-by-picture trainings in src/training/.
// A training is a <TrainingPage> of <Step>s, each with a line or two of
// text and a <Screen> drawn from the real app's labels, with <Hit> rings on
// what to tap. `s` is the class list for drawing the screens themselves.
export { s };

type Kids = { children: React.ReactNode };

export function TrainingPage({ children }: Kids) {
  return <div className={s.page}>{children}</div>;
}

export function Need({ title, children }: Kids & { title: string }) {
  return (
    <div className={s.need}>
      <strong className={s.needTitle}>{title}</strong>
      {children}
    </div>
  );
}

export function Step({ n, title, optional, id, children }: Kids & { n: number | string; title: string; optional?: boolean; id?: string }) {
  return (
    <section className={s.step} id={id}>
      <div className={s.stepHead}>
        <span className={`${s.num} ${optional ? s.numOpt : ""}`}>{n}</span>
        <h3 className={s.stepTitle}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

// A drawn screen: browser bar with its address, the picture, a caption.
export function Screen({ url, caption, label, stripe, children }: Kids & { url: string; caption?: string; label: string; stripe?: boolean }) {
  return (
    <div className={`${s.screen} ${stripe ? s.stripe : ""}`} role="img" aria-label={label}>
      <div className={s.bar}>
        <span className={s.dots}>
          <i />
          <i />
          <i />
        </span>
        <span className={s.url}>{url}</span>
      </div>
      <div className={s.pane}>{children}</div>
      {caption && <div className={s.caption}>{caption}</div>}
    </div>
  );
}

// The pulsing "tap here" ring, with its step number.
export function Hit({ n, className = "", children }: Kids & { n?: string | number; className?: string }) {
  return (
    <span className={`${s.hit} ${className}`} data-n={n === undefined ? undefined : String(n)}>
      {children}
    </span>
  );
}

export function Tip({ children }: Kids) {
  return <p className={s.tip}>{children}</p>;
}

export function DoDont({ ok, no, okTitle = "OK", noTitle = "Never" }: { ok: React.ReactNode[]; no: React.ReactNode[]; okTitle?: string; noTitle?: string }) {
  return (
    <div className={s.rules}>
      <div className={s.ruleBox}>
        <div className={`${s.ruleHead} ${s.ruleOk}`}>✓ {okTitle}</div>
        <ul className={s.ruleList}>
          {ok.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      <div className={s.ruleBox}>
        <div className={`${s.ruleHead} ${s.ruleNo}`}>✕ {noTitle}</div>
        <ul className={s.ruleList}>
          {no.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// The back office's menu row, with one item ringed.
export function BackOfficeNav({ ring, n }: { ring?: string; n?: string | number }) {
  const items = ["Dashboard", "Point of sale", "Menu", "Ingredients", "Showtimes", "Members", "Events", "Booths", "Reports", "Team", "Training", "Schedule graphic", "Displays", "Staff"];
  return (
    <>
      <div className={s.boTitle}>Royale Cinema Lounge — Back office</div>
      <div className={s.nav}>
        {items.map((i) =>
          i === ring ? (
            <Hit key={i} n={n}>
              <b>{i}</b>
            </Hit>
          ) : (
            <span key={i}>{i}</span>
          ),
        )}
        <span className={s.dim}>View site</span>
      </div>
    </>
  );
}
