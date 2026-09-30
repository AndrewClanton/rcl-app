"use client";

import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

// Press and hold (about 600ms) on a register button, for its settings. A
// normal tap still does what it always did; a hold never does it too:
//   - the hold is dropped if the finger moves (the menu is being scrolled),
//     lifts early, or the browser takes the touch over
//   - once a hold fires, the click the browser sends when the finger lifts
//     is swallowed, wherever it lands (the button, or the PIN box that just
//     opened under the finger)
//   - no text selection, callout or image drag on a long touch (the CSS for
//     [data-hold] in globals.css)
//
// One press at a time is plenty on a register, so its state lives here.

export const HOLD_MS = 600;
const SLOP_PX = 10;

export interface HoldHandlers {
  "data-hold": "";
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
}

type Press = { el: HTMLElement; pointerId: number; x: number; y: number; timer: number; fired: boolean };
let press: Press | null = null;

function drop() {
  if (!press) return;
  window.clearTimeout(press.timer);
  press.el.removeAttribute("data-holding");
  press = null;
}

// The click that follows a hold, wherever it lands. Given up soon after the
// finger lifts (or after a few seconds at most), so the next tap is never
// eaten by mistake.
function swallowNextClick() {
  let giveUp = window.setTimeout(done, 5000);
  function block(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    done();
  }
  function lifted() {
    window.clearTimeout(giveUp);
    giveUp = window.setTimeout(done, 600);
  }
  function done() {
    window.clearTimeout(giveUp);
    window.removeEventListener("click", block, true);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", lifted, true);
  }
  window.addEventListener("click", block, true);
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", lifted, true);
}

export function holdHandlers(onHold: () => void): HoldHandlers {
  return {
    "data-hold": "",
    onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drop();
      const el = e.currentTarget;
      const p: Press = { el, pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer: 0, fired: false };
      p.timer = window.setTimeout(() => {
        if (press !== p) return;
        p.fired = true;
        el.removeAttribute("data-holding");
        swallowNextClick();
        navigator.vibrate?.(12);
        onHold();
      }, HOLD_MS);
      // A slow press-in while it's held, so it's clear something's coming.
      el.setAttribute("data-holding", "");
      press = p;
    },
    onPointerMove(e) {
      if (press && !press.fired && press.pointerId === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) drop();
    },
    onPointerUp(e) {
      if (!press || press.pointerId !== e.pointerId) return;
      if (press.fired) press = null;
      else drop();
    },
    onPointerCancel() {
      if (press && !press.fired) drop();
    },
    onPointerLeave(e) {
      if (press && !press.fired && press.pointerId === e.pointerId) drop();
    },
    // A long touch on Android (and a right-click) asks for a menu instead.
    onContextMenu(e) {
      e.preventDefault();
    },
  };
}
