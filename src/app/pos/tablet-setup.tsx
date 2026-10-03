"use client";

import { createContext, useContext, useEffect, useEffectEvent, useId, useRef } from "react";
import type { StaffSetup } from "@/lib/registerChannel";

// The register's side of "We're setting up your account" on the customer
// screen (lib/registerChannel.ts StaffSetup): a form staff fill in for a
// guest standing there ("New phone account", "+ Add name", "+ Add email")
// shows on the tablet as they type, and the guest's "✓ That's right" comes
// back here to save it. PosApp provides the link (its channel to the
// screen); without it (anywhere else a form is used) nothing is mirrored.
export interface TabletSetupLink {
  send: ((event: string, payload: object) => void) | null;
  // A form's "✓ That's right" handler, by its id, while it's open; returns
  // the way to let go of it.
  listen: ((id: string, onOk: () => void) => () => void) | null;
}

export const TabletSetupContext = createContext<TabletSetupLink>({ send: null, listen: null });

// What a form shows the guest: never more than lib/registerChannel.ts allows.
export type SetupView = Omit<StaffSetup, "id" | "stage">;

// This page load's own prefix, so two registers' forms never share an id.
const SESSION = Math.random().toString(36).slice(2, 8);
const TYPING_MS = 180;

// For a form while it's open (`open`): the tablet switches over the moment
// it opens and follows what's typed, a moment after each keystroke; closed
// without saving (Cancel, or the form went away), it goes back to normal.
// onGuestOk: the guest tapped "✓ That's right" (the form saves). saved():
// it's saved, so the tablet says "You're all set" (call it before the form
// closes). mirrored: there's a customer screen following along.
export function useTabletMirror(open: boolean, view: SetupView, onGuestOk: () => void): { mirrored: boolean; saved: () => void } {
  const { send, listen } = useContext(TabletSetupContext);
  const id = SESSION + useId();
  const done = useRef(false);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = JSON.stringify(view);
  const guestOk = useEffectEvent(onGuestOk);

  useEffect(() => {
    if (!open || !send) return;
    done.current = false;
    const stop = listen?.(id, () => guestOk());
    return () => {
      stop?.();
      if (typing.current) clearTimeout(typing.current);
      if (!done.current) send("staff-setup-end", { id });
    };
  }, [open, send, listen, id]);

  useEffect(() => {
    if (!open || !send) return;
    const payload: StaffSetup = { id, stage: "typing", ...(JSON.parse(shown) as SetupView) };
    const timer = setTimeout(() => send("staff-setup", payload), TYPING_MS);
    typing.current = timer;
    return () => clearTimeout(timer);
  }, [open, send, id, shown]);

  return {
    mirrored: !!send,
    saved: () => {
      if (!send) return;
      done.current = true;
      if (typing.current) clearTimeout(typing.current);
      const payload: StaffSetup = { id, stage: "saved", what: view.what };
      send("staff-setup", payload);
    },
  };
}
