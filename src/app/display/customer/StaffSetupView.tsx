"use client";

import type { StaffSetup } from "@/lib/registerChannel";
import k from "./kiosk.module.css";

// "We're setting up your account": staff are filling in a guest's account on
// the register (lib/registerChannel.ts StaffSetup) for a guest who'd rather
// just tell them, and the whole screen follows along, calm and big, so the
// guest can check it as it's typed and tap "✓ That's right" (or staff just
// save it). Saved: "You're all set" for a moment, then their card beside
// the order. Everything shown is the screen's own words around what the
// register sent, checked here (parseSetup): a phone number as typed, a first
// name and last initial, an email masked.

export interface ShownSetup {
  id: string;
  what: StaffSetup["what"];
  stage: StaffSetup["stage"];
  phone: string;
  name: string;
  email: string;
  ready: boolean;
  hold: boolean;
  sent: boolean; // the guest tapped "✓ That's right"
}

// Letters (any alphabet), spaces, periods, apostrophes and hyphens. Built
// with the RegExp constructor: the \p{} classes need a newer compile target.
const NOT_NAME = new RegExp("[^\\p{L}\\p{M} .'’-]", "gu");

// What the register sent, or null if it isn't a setup message.
export function parseSetup(p: Partial<StaffSetup> | null | undefined): Omit<ShownSetup, "sent"> | null {
  if (!p || typeof p.id !== "string" || !p.id || p.id.length > 80) return null;
  if (p.what !== "phone" && p.what !== "name" && p.what !== "email") return null;
  if (p.stage !== "typing" && p.stage !== "saved") return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    id: p.id,
    what: p.what,
    stage: p.stage,
    phone: text(p.phone, 20).replace(/[^\d() -]/g, "").slice(0, 14),
    name: text(p.name, 60).replace(NOT_NAME, "").replace(/\s+/g, " ").trim().slice(0, 44),
    email: text(p.email, 80).replace(/[^a-z0-9•@._+-]/gi, "").slice(0, 64),
    ready: p.ready === true,
    hold: p.hold === true,
  };
}

export default function StaffSetupView({ setup, greet, onOk }: { setup: ShownSetup; greet: string | null; onOk: () => void }) {
  if (setup.stage === "saved") {
    return (
      <div className={k.setup} role="status" aria-live="polite">
        <div className={`${k.setupCard} ${k.setupDone}`}>
          <div className={k.check} aria-hidden="true">
            ✓
          </div>
          <h1 className={k.setupTitle}>You&apos;re all set{greet ? `, ${greet}` : ""}!</h1>
          <p className={k.big}>
            {setup.what === "phone"
              ? "Your phone number is your account. Just type it each time you come in, and your points add up."
              : setup.what === "name"
                ? "Your name is on your account."
                : "Your email is on your account."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={k.setup} role="dialog" aria-modal="true" aria-labelledby="staff-setup-title">
      <div className={k.setupCard}>
        <div>
          <div className={k.eyebrow}>One moment</div>
          <h1 id="staff-setup-title" className={k.setupTitle}>
            We&apos;re setting up your account
          </h1>
          <p className={k.big} style={{ marginTop: 8 }}>
            Check it as we type.
          </p>
        </div>
        <dl className={k.setupRows}>
          {setup.what === "phone" && <Row label="Phone number" value={setup.phone} empty="(___) ___-____" mono />}
          {setup.what !== "email" && <Row label={setup.what === "phone" ? "First name" : "Your name"} value={setup.name} empty={setup.what === "phone" ? "If you like" : "…"} />}
          {setup.what === "email" && <Row label="Email" value={setup.email} empty="…" note="Partly hidden, for your privacy" />}
        </dl>
        <button type="button" className={`${k.cta} ${k.setupOk}`} disabled={!setup.ready || setup.sent} onClick={onOk}>
          {setup.sent ? "Thanks! Saving…" : "✓ That's right"}
        </button>
        <p className={k.setupFoot}>{setup.hold ? "One moment: we're checking something." : "Something not right? Just tell us."}</p>
      </div>
    </div>
  );
}

function Row({ label, value, empty, mono = false, note }: { label: string; value: string; empty: string; mono?: boolean; note?: string }) {
  return (
    <div className={k.setupRow}>
      <dt className={k.fieldLabel}>
        {label}
        {note && <span className={k.setupNote}> · {note}</span>}
      </dt>
      <dd className={`${k.setupValue} ${mono ? k.setupMono : ""} ${value ? "" : k.setupEmpty}`}>{value || empty}</dd>
    </div>
  );
}
