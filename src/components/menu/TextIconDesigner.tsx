"use client";

import { useState } from "react";
import MenuTile from "./MenuTile";
import TextIcon from "./TextIcon";
import {
  cleanIconText,
  iconTextLength,
  iconTextSuggestions,
  suggestIconText,
  TEXT_ICON_COLOR_KEYS,
  TEXT_ICON_COLORS,
  TEXT_ICON_MAX,
  TEXT_ICON_STYLES,
  textIconOf,
  type TextIcon as Icon,
  type TextIconColor,
  type TextIconStyle,
} from "@/lib/menu-pictures/text-icon";
import type { PictureResult, PictureState } from "@/lib/menu-pictures/shared";

// Making a text icon for a register button ("$5" glowing red): a few
// characters, a color and a style, with the real button beside it as it
// will look on the register (and as the small thumbnail in Back office).
// Shared by the register's item settings and Back office → Menu, which hand
// in their own `save` (each checks who's asking its own way).

const noop = () => {};

export default function TextIconDesigner({
  name,
  price,
  current,
  save,
  onSaved,
  onCancel,
}: {
  name: string;
  price: number | null;
  current: PictureState;
  save: (icon: Icon) => Promise<PictureResult>;
  onSaved: (picture: PictureState) => void;
  onCancel: () => void;
}) {
  const had = current.image_source === "text" ? current.image_text : null;
  const [text, setText] = useState(had?.text ?? suggestIconText(name));
  const [color, setColor] = useState<TextIconColor>(had?.color ?? "red");
  const [style, setStyle] = useState<TextIconStyle>(had?.style ?? "neon");
  const [pulse, setPulse] = useState(!!had?.pulse);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icon = textIconOf({ text, color, style, pulse: style === "neon" && pulse });
  const count = iconTextLength(cleanIconText(text));
  const suggestions = iconTextSuggestions(name, price);
  const priceText = typeof price === "number" && Number.isFinite(price) ? `$${price.toFixed(2)}` : "";

  async function use() {
    if (!icon || busy) return setError(count > TEXT_ICON_MAX ? `Keep it to ${TEXT_ICON_MAX} characters.` : "Type what the button should say.");
    setBusy(true);
    setError(null);
    try {
      const r = await save(icon);
      if (!r.ok) return setError(r.error);
      onSaved(r.picture);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const empty = (
    <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs" style={{ background: "#0b0b0e", color: "#9a9aa5" }}>
      Type what it should say
    </span>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void use();
      }}
    >
      {/* The button as the register will show it. Not pressable here. */}
      <div className="flex items-end justify-center gap-4">
        <div className="w-[190px] shrink-0" inert>
          <MenuTile name={name} price={priceText} art={icon ? <TextIcon icon={icon} /> : empty} out={null} onClick={noop} />
        </div>
        <div className="flex flex-col items-center gap-1 pb-1" inert>
          <div className="h-14 w-14 overflow-hidden rounded-md border" style={{ borderColor: "var(--border)" }}>
            {icon ? <TextIcon icon={icon} still /> : empty}
          </div>
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
            Small
          </span>
        </div>
      </div>

      <label className="block">
        <div className="label-xs flex justify-between">
          <span>What it says</span>
          <span className="tabular-nums" style={{ color: count > TEXT_ICON_MAX ? "var(--danger-text)" : undefined }}>
            {count} / {TEXT_ICON_MAX}
          </span>
        </div>
        <input
          className="input font-display !py-2.5 !text-2xl"
          value={text}
          maxLength={TEXT_ICON_MAX * 2}
          autoComplete="off"
          spellCheck={false}
          placeholder="$5"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          Short reads best: up to 6 characters show huge.
        </span>
      </label>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className={`chip min-h-11 font-display !text-sm ${cleanIconText(text) === s ? "chip-selected" : ""}`} onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <fieldset>
        <legend className="label-xs">Color</legend>
        <div className="flex flex-wrap gap-2.5">
          {TEXT_ICON_COLOR_KEYS.map((key) => {
            const c = TEXT_ICON_COLORS[key];
            const on = key === color;
            return (
              <button
                key={key}
                type="button"
                className="h-11 w-11 rounded-full border"
                style={{
                  background: c.glow,
                  borderColor: "rgba(0, 0, 0, 0.25)",
                  boxShadow: on ? "0 0 0 3px var(--surface), 0 0 0 5px var(--foreground)" : undefined,
                }}
                aria-label={c.name}
                aria-pressed={on}
                title={c.name}
                onClick={() => setColor(key)}
              />
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label-xs">Style</legend>
        <div className="grid grid-cols-3 gap-2">
          {TEXT_ICON_STYLES.map((s) => {
            const on = s.key === style;
            const sample = textIconOf({ text: cleanIconText(text) || "$5", color, style: s.key }) ?? { text: "$5", color, style: s.key };
            return (
              <button
                key={s.key}
                type="button"
                className="flex min-h-11 flex-col items-center gap-1.5 rounded-lg border-2 p-2 text-sm font-bold"
                style={{ borderColor: on ? "var(--accent)" : "var(--border)", background: on ? "var(--accent-soft)" : undefined }}
                aria-pressed={on}
                onClick={() => setStyle(s.key)}
              >
                <span className="block h-10 w-10 overflow-hidden rounded">
                  <TextIcon icon={sample} still />
                </span>
                {s.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      {style === "neon" && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" className="h-6 w-6 shrink-0" checked={pulse} onChange={(e) => setPulse(e.target.checked)} />
          <span>
            <span className="block font-bold">Slow glow</span>
            <span className="block text-xs" style={{ color: "var(--muted)" }}>
              The glow fades gently in and out. It stays still on a device set to reduce motion.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-12 flex-1 !text-base" disabled={!icon || busy}>
          {busy ? "Saving…" : "Use this icon"}
        </button>
        <button type="button" className="btn-secondary min-h-12 !text-base" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-sm font-bold" style={{ color: "var(--danger-text)" }} role="status">
          {error}
        </p>
      )}
    </form>
  );
}
