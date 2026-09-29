"use client";

import { useEffect, useRef } from "react";

// A USB or Bluetooth barcode scanner is a keyboard: it "types" the QR code's
// text and presses Enter. This listens on the register page for exactly
// that (a burst of keys far faster than anyone types, ending in Enter, that
// starts with RCLT: for an online ticket or RCL: for a member card) and hands
// over the text. Normal typing is never held back; if a burst lands in a
// text box (the member search, say), the scanned characters are taken back
// out of it so it's left as it was.
//
// Mounted once, in PosApp:
//   useScanner((text) => { void onScan(text); }, { enabled: !payOpen });

export type ScanKind = "ticket" | "member";

export interface ScannerOptions {
  enabled?: boolean; // false while a modal (payment, say) owns the keyboard
  // Slower than this a key on average, and it's a person. Raise it (to 50,
  // say) if a slow Bluetooth scanner's codes land in the search box instead.
  maxGapMs?: number;
}

const DEFAULT_GAP_MS = 35;
// The Enter can trail the last character a little (some scanners pause).
const ENTER_GAP_MS = 150;
// Shorter than any of our codes: "RCL:" plus a member id is 40.
const MIN_LENGTH = 12;
const PREFIX = /RCLT?:/i;

export function scanKind(text: string): ScanKind {
  return /^RCLT:/i.test(text) ? "ticket" : "member";
}

// The timing rules on their own, with no page, so they can be checked
// directly (scripts/check-door-tickets.mjs). Feed it every key; enter()
// returns the scanned text when the burst was a scan.
//
// A scan is judged on its average pace (under maxGapMs a key), not every
// single gap, so one late key from a Bluetooth scanner doesn't spoil it.
// Nobody types forty-odd characters at that pace; a pause long enough for a
// person (pauseMs) starts over.
export function createScanDetector(maxGapMs = DEFAULT_GAP_MS) {
  const pauseMs = Math.max(100, maxGapMs * 3);
  let keys: { ch: string; at: number }[] = [];
  return {
    key(ch: string, at: number) {
      const last = keys[keys.length - 1];
      if (last && at - last.at > pauseMs) keys = [];
      keys.push({ ch, at });
    },
    // Enter pressed at `at`: the scan, or null for ordinary typing.
    enter(at: number): string | null {
      const burst = keys;
      keys = [];
      // A stray key typed just before the scanner started joins the burst;
      // the scan is from its prefix on.
      const start = burst
        .map((k) => k.ch)
        .join("")
        .search(PREFIX);
      if (start < 0) return null;
      const scan = burst.slice(start);
      if (scan.length < MIN_LENGTH) return null;
      const first = scan[0].at;
      const last = scan[scan.length - 1].at;
      if (at - last > Math.max(ENTER_GAP_MS, maxGapMs)) return null;
      if ((last - first) / (scan.length - 1) > maxGapMs) return null;
      return scan.map((k) => k.ch).join("");
    },
    reset() {
      keys = [];
    },
  };
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && /^(text|search|tel|email|url|password|number)$/.test(el.type || "text");
}

// Takes the scanned characters back out of the box they landed in, through
// the native setter plus an input event, so React's onChange sees it too.
function removeScanFrom(el: HTMLInputElement | HTMLTextAreaElement, scan: string) {
  const value = el.value;
  let caret: number | null = null;
  try {
    caret = el.selectionStart;
  } catch {
    // number and email boxes have no caret position
  }
  // Usually it sits just before the caret; otherwise its last appearance.
  const at = caret !== null && caret >= scan.length && value.slice(caret - scan.length, caret) === scan ? caret - scan.length : value.lastIndexOf(scan);
  if (at < 0) return;
  const next = value.slice(0, at) + value.slice(at + scan.length);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    el.setSelectionRange(at, at);
  } catch {
    // no caret to put back
  }
}

export function useScanner(onScan: (text: string, kind: ScanKind) => void, { enabled = true, maxGapMs = DEFAULT_GAP_MS }: ScannerOptions = {}) {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    const detector = createScanDetector(maxGapMs);

    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        detector.reset();
        return;
      }
      if (e.key === "Enter") {
        const scan = detector.enter(e.timeStamp);
        if (!scan) return;
        // Ours: don't let this Enter submit a form or press a focused button.
        e.preventDefault();
        e.stopImmediatePropagation();
        const target = e.target instanceof Element ? e.target : document.activeElement;
        if (isTextField(target)) removeScanFrom(target, scan);
        onScanRef.current(scan, scanKind(scan));
        return;
      }
      if (e.key.length === 1) detector.key(e.key, e.timeStamp);
      // Shift and Caps Lock come between a scanner's characters; anything
      // else (Backspace, Tab, arrows) means a person is typing.
      else if (e.key !== "Shift" && e.key !== "CapsLock") detector.reset();
    }

    // Capture, on the window: sees the keys before any box or button does.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, maxGapMs]);
}
