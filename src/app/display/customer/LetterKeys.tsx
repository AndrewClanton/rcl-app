"use client";

import k from "./kiosk.module.css";

// The full keyboard for "Phone or email" on the customer tablet
// (CheckinKiosk.tsx): letters, digits and what email addresses use, laid
// out like a phone's, plus quick chips for the usual email domains. Big
// keys (at least 44px each way at 1005x600 and 600x1005) and no shift:
// addresses are matched case-insensitively.
// "digits" goes back to the number keypad.

export type LetterKey = string | "back" | "clear" | "digits";

// Each row is 20 columns; a key is 2 unless it says otherwise.
type Key = { key: LetterKey; label?: string; span?: number; aria?: string };
const ROWS: Key[][] = [
  "1234567890".split("").map((c) => ({ key: c })),
  "qwertyuiop".split("").map((c) => ({ key: c })),
  "asdfghjkl".split("").map((c) => ({ key: c })),
  [...("zxcvbnm".split("").map((c) => ({ key: c })) as Key[]), { key: "." }, { key: "back", label: "⌫", span: 4, aria: "Delete last character" }],
  [
    { key: "digits", label: "123", span: 4, aria: "Number keypad" },
    { key: "-" },
    { key: "_" },
    { key: "@", span: 4 },
    { key: ".com", span: 4 },
    { key: "clear", label: "Clear", span: 4 },
  ],
];

export const EMAIL_DOMAINS = ["@gmail.com", "@yahoo.com", "@icloud.com", "@hotmail.com", "@outlook.com"];

export default function LetterKeys({ disabled, onKey, onDomain }: { disabled: boolean; onKey: (key: LetterKey) => void; onDomain: (domain: string) => void }) {
  return (
    <>
      <div className={k.chips} role="group" aria-label="Email endings">
        {EMAIL_DOMAINS.map((d) => (
          <button key={d} type="button" className={k.chip} disabled={disabled} onClick={() => onDomain(d)}>
            {d}
          </button>
        ))}
      </div>
      <div className={k.letterKeys}>
        {ROWS.map((row, r) =>
          row.map((x, i) => (
            <button
              key={`${r}-${x.key}`}
              type="button"
              className={`${k.lkey} ${x.key.length > 1 ? k.lkeySmall : ""} ${x.key === "@" ? k.lkeyAt : ""}`}
              // The third row sits half a key in, as on a phone.
              style={{ gridColumn: `${r === 2 && i === 0 ? "2 / " : ""}span ${x.span ?? 2}` }}
              disabled={disabled}
              onClick={() => onKey(x.key)}
              aria-label={x.aria ?? x.label ?? x.key}
            >
              {x.label ?? x.key}
            </button>
          )),
        )}
      </div>
    </>
  );
}
