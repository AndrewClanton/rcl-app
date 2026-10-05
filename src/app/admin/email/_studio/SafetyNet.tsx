import { WAVE_BRAKE } from "@/lib/email/campaign-send";
import { StopSending } from "../OverviewControls";

// "Your safety net": what keeps a mistake small, in plain words, from the
// real settings (the first wave's size, the brake's limits, whether Resend
// holds email so Undo works), and the Emergency stop: quiet, but there.
// Any manager can press it (stopAllSending checks); only someone who sends
// can resume.

export default function SafetyNet({ firstWave, undo, waitingAtResend }: { firstWave: number; undo: boolean; waitingAtResend: number }) {
  const bounce = Math.round(WAVE_BRAKE.bounceRate * 100);
  const items = [
    { t: "A few people first", d: `A ready-made email goes to ${firstWave} of our most regular regulars first. You see how they liked it before anyone else gets it.` },
    undo
      ? { t: "A minute to undo", d: "After you press Send, you have a minute to take the wave back before anyone gets it." }
      : { t: "No Undo just now", d: "Resend wouldn't hold email for later, so each wave goes as soon as it's pressed for. Pause still stops the rest." },
    { t: "It brakes by itself", d: `If more than ${bounce} in 100 of a wave bounce, or someone marks it as spam, it stops and waits for someone who sends to check.` },
    { t: "Pause any time", d: "Pause stops the rest, and calls back anything not delivered yet." },
  ];
  return (
    <section aria-labelledby="net-h" className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
          <path d="M8.5 12l2.5 2.5 4.5-5" />
        </svg>
        <h2 id="net-h" className="font-display text-2xl">
          Your safety net
        </h2>
      </div>
      <ul className="grid list-none gap-5 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((i) => (
          <li key={i.t} className="flex flex-col gap-1">
            <span className="font-bold">{i.t}</span>
            <span className="text-[15px] text-[#4a4336]">{i.d}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
        <span className="min-w-0 flex-1 basis-64">
          Never sent to anyone who unsubscribed, turned email off or bounced.
          {waitingAtResend > 0 ? ` ${waitingAtResend.toLocaleString()} waiting at Resend for later.` : ""}
        </span>
        <StopSending />
      </div>
      <p className="text-xs text-[var(--muted)]">
        Emergency stop pauses every email to a list and calls back everything Resend is holding to send later (a big list takes a few minutes; it carries on until
        none is left). Any manager can press it, and it can be pressed again. Only someone who sends email can resume afterwards.
      </p>
    </section>
  );
}
