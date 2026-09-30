"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AUTH_COOKIE_SOURCE, PLUS_HINT_KEY } from "./plus-hint";

// Draws nothing. Sits in the public site's header and does two jobs there:
//
// 1. The Insiders+ look (see plus-hint.ts): after the page loads, asks
//    /api/member-state whether this visitor is an Insiders+ member and sets
//    data-plus on the .site wrapper to match. Visitors with no login cookie
//    are never asked about (no request at all). Checked again on each page
//    change, since signing in or out happens without reloading the layout,
//    but a login it already asked about in the last few minutes isn't asked
//    again.
//
// 2. The header's real height, as --site-header-h on the wrapper, which
//    in-page jumps (the day chips on Showtimes, #insiders, #faq) use as
//    their scroll offset so a heading doesn't land under the sticky header.
//    The nav wraps to a different number of rows on every phone width, so
//    it's measured rather than guessed (globals.css has per-breakpoint
//    fallbacks for the moment before this runs).

const RECHECK_MS = 5 * 60_000;
const authCookie = new RegExp(`${AUTH_COOKIE_SOURCE}([^;]*)`, "g");

type Hint = { login: string; plus: boolean; at: number };

// A short fingerprint of the current login (it changes when someone signs
// in, out, or as someone else), so the token itself is never copied into
// storage.
function loginFingerprint(): string | null {
  const values = [...document.cookie.matchAll(authCookie)].map((m) => m[1]).join("|");
  if (!values) return null;
  let h = 5381;
  for (let i = 0; i < values.length; i++) h = ((h * 33) ^ values.charCodeAt(i)) >>> 0;
  return `${values.length}.${h.toString(36)}`;
}

function readHint(): Hint | null {
  try {
    return JSON.parse(localStorage.getItem(PLUS_HINT_KEY) ?? "null") as Hint | null;
  } catch {
    return null;
  }
}

function writeHint(hint: Hint | null) {
  try {
    if (hint) localStorage.setItem(PLUS_HINT_KEY, JSON.stringify(hint));
    else localStorage.removeItem(PLUS_HINT_KEY);
  } catch {
    // Private browsing or storage turned off: the fetch still sets the look.
  }
}

export default function SiteHeaderSync() {
  const ref = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();

  // The Insiders+ look.
  useEffect(() => {
    const site = ref.current?.closest<HTMLElement>(".site");
    if (!site) return;
    const setPlus = (plus: boolean) => site.toggleAttribute("data-plus", plus);

    const login = loginFingerprint();
    if (!login) {
      setPlus(false);
      writeHint(null);
      return;
    }
    const hint = readHint();
    if (hint && hint.login === login && Date.now() - hint.at < RECHECK_MS) {
      setPlus(hint.plus);
      return;
    }

    const controller = new AbortController();
    fetch("/api/member-state", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ plus?: boolean }>) : Promise.reject(new Error(`status ${res.status}`))))
      .then((data) => {
        const plus = !!data.plus;
        setPlus(plus);
        writeHint({ login, plus, at: Date.now() });
      })
      .catch(() => {
        // Offline or a hiccup: keep whatever the page shows now.
      });
    return () => controller.abort();
  }, [pathname]);

  // The header's height, for scroll offsets.
  useEffect(() => {
    const header = ref.current?.closest("header");
    const site = header?.closest<HTMLElement>(".site");
    if (!header || !site) return;
    const update = () => site.style.setProperty("--site-header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return <span ref={ref} hidden />;
}
