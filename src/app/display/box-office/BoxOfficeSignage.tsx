"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { RATE_PRICE } from "@/lib/membership-rates";
import { boardAt, clock, dayLabel, longDate, startsLabel, type BoardShow } from "./board";

// The lobby TV, read from 15+ feet away. Laid out as a fixed 1920x1080
// landscape stage and scaled to whatever the TV reports, so type sizes are
// the same on a 1080p or a 4K panel: the next show huge, then the rest of
// today's and the coming days' shows in big rows. Royale Proof Sheet style:
// cream paper, ink rules, a yellow halftone hero.
//
// A public page with no login. The schedule comes from the server (which
// drops older MPLC titles and sends only what's shown here) and is
// re-fetched every minute; the browser never reads the database itself.
const STAGE_W = 1920;
const STAGE_H = 1080;
const REFRESH_MS = 60_000;

// The vertical budget: masthead 114 + padding 54 + hero 500 + gap 30 +
// list (head 56 + MAX_ROWS rows of 78 + borders 8 = 376) = 1074 of 1080.
const HERO_H = 500;
const LIST_HEAD_H = 56;
const ROW_H = 78;

const INK = "#14110c";
const CREAM = "#f8f5ec";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const GOLD = "#ffc72c";
const RED = "#ed1c24";

// ---- External stores: the clock and the viewport ---------------------------
// The server's clock is the reference (a TV stick's clock can be off by
// minutes); the offset is refreshed on every server render.
let clockOffset = 0;
const subscribeClock = (cb: () => void) => {
  const id = setInterval(cb, 250);
  return () => clearInterval(id);
};
const getClockSecond = () => Math.floor((Date.now() + clockOffset) / 1000);
const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const getViewport = () => `${window.innerWidth}x${window.innerHeight}`;
const getZero = () => 0;
const getEmpty = () => "";

export default function BoxOfficeSignage({ shows, serverNow }: { shows: BoardShow[]; serverNow: number }) {
  const router = useRouter();

  useEffect(() => {
    clockOffset = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const second = useSyncExternalStore(subscribeClock, getClockSecond, getZero);
  const viewport = useSyncExternalStore(subscribeResize, getViewport, getEmpty);
  const minute = Math.floor(second / 60);
  const now = second * 1000;
  // The board only changes minute to minute; the clock ticks on its own.
  const board = useMemo(() => boardAt(shows, minute * 60_000), [shows, minute]);

  // Nothing time-dependent renders on the server -- avoids a hydration
  // mismatch and a flash of the wrong show.
  if (!second || !viewport) return <div style={{ position: "fixed", inset: 0, background: INK }} />;

  const [vw, vh] = viewport.split("x").map(Number);
  const scale = Math.min(vw / STAGE_W, vh / STAGE_H);

  return (
    <div style={{ position: "fixed", inset: 0, background: INK, overflow: "hidden", cursor: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          display: "flex",
          flexDirection: "column",
          background: CREAM,
          color: INK,
        }}
      >
        <Masthead now={now} />
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 30, padding: "28px 48px 26px" }}>
          {board.hero ? <Hero show={board.hero} nowShowing={board.nowShowing} now={minute * 60_000} /> : <Empty />}
          <Rows rows={board.rows} now={minute * 60_000} />
        </main>
      </div>
    </div>
  );
}

function Masthead({ now }: { now: number }) {
  return (
    <header style={{ flexShrink: 0, background: INK, color: CREAM }}>
      <div style={{ height: 92, padding: "0 48px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40 }}>
        <div className="font-display" style={{ fontSize: 46, letterSpacing: 1, color: GOLD, whiteSpace: "nowrap" }}>
          ROYALE CINEMA LOUNGE
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 32, whiteSpace: "nowrap" }}>
          <span className="font-mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "rgba(248,245,236,0.75)" }}>
            {longDate(now)}
          </span>
          <span className="font-display" style={{ fontSize: 58, lineHeight: 1, color: GOLD, fontVariantNumeric: "tabular-nums" }}>
            {clock(now)}
          </span>
        </div>
      </div>
      {/* The film's edge: a row of perforations under the ink bar. */}
      <div aria-hidden="true" style={{ height: 12, margin: "0 48px 10px", backgroundImage: `repeating-linear-gradient(90deg, ${CREAM} 0 18px, transparent 18px 30px)`, opacity: 0.85 }} />
    </header>
  );
}

const PANEL = { background: GOLD, border: `5px solid ${INK}`, borderRadius: 10, boxShadow: `12px 12px 0 ${INK}` };

function Hero({ show, nowShowing, now }: { show: BoardShow; nowShowing: boolean; now: number }) {
  const starts = startsLabel(show.startsAt, now);
  const meta = [show.rating, show.runtimeMinutes ? `${show.runtimeMinutes} min` : null].filter(Boolean).join(" · ");
  return (
    <section className="halftone halftone-hero" style={{ ...PANEL, height: HERO_H, flexShrink: 0, display: "flex", gap: 40, padding: 32 }}>
      {/* Above the halftone dots (z-index), so nothing prints over the poster. */}
      {show.posterUrl && (
        <div style={{ position: "relative", zIndex: 1, width: 284, height: 426, flexShrink: 0, border: `5px solid ${INK}`, borderRadius: 6, overflow: "hidden", background: INK, boxShadow: `10px 10px 0 ${RED}` }}>
          <Image src={show.posterUrl} alt="" fill sizes="284px" style={{ objectFit: "cover" }} priority />
        </div>
      )}
      <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ height: 64, flexShrink: 0, display: "flex", alignItems: "center", gap: 28 }}>
          <span className={`ctag ${nowShowing ? "ctag-red" : "ctag-ink"}`} style={{ fontSize: 32, padding: "8px 20px", borderWidth: 5 }}>
            {nowShowing ? "Now showing" : "Next show"}
          </span>
          {!nowShowing && (
            <span className="font-display" style={{ fontSize: 42, textTransform: "uppercase", whiteSpace: "nowrap" }}>
              {dayLabel(show.startsAt, now, true)}
            </span>
          )}
          {starts && (
            <span
              className="font-mono"
              style={{ marginLeft: "auto", fontSize: 30, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap", background: INK, color: GOLD, padding: "8px 18px", borderRadius: 4 }}
            >
              {starts}
            </span>
          )}
        </div>
        <FitTitle text={show.title} max={150} min={56} />
        <div style={{ height: 108, flexShrink: 0, display: "flex", alignItems: "flex-end", gap: 34 }}>
          <div className="font-display" style={{ fontSize: 104, lineHeight: 0.86, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {clock(show.startsAt)}
          </div>
          <div aria-hidden="true" style={{ width: 5, alignSelf: "stretch", background: INK, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="font-mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>
              Screen
            </div>
            <div className="font-display" style={{ fontSize: 52, lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {show.room}
            </div>
          </div>
          {meta && (
            <div className="font-mono" style={{ marginLeft: "auto", flexShrink: 0, fontSize: 28, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>
              {meta}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// The title as big as its box allows: one line if it fits, otherwise two
// or three, stepping the size down until it fits the box.
function FitTitle({ text, max, min }: { text: string; max: number; min: number }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && (el.offsetHeight > box.clientHeight || el.scrollWidth > box.clientWidth)) {
        size -= 4;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    // Measure again once Archivo Black has loaded (it's wider than the fallback).
    document.fonts?.ready.then(fit);
  }, [text, max, min]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>
      <h1 ref={ref} className="font-display" style={{ width: "100%", fontSize: max, lineHeight: 0.98, textWrap: "balance" }}>
        {text}
      </h1>
    </div>
  );
}

function Empty() {
  return (
    <section className="halftone halftone-hero" style={{ ...PANEL, height: HERO_H, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 48 }}>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="font-display" style={{ fontSize: 108, lineHeight: 1 }}>
          Nothing on the schedule right now.
        </div>
        <div className="font-display" style={{ marginTop: 30, fontSize: 48 }}>
          Ask at the counter what&apos;s coming up.
        </div>
      </div>
    </section>
  );
}

function Rows({ rows, now }: { rows: BoardShow[]; now: number }) {
  return (
    <section style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff", border: `4px solid ${INK}`, borderRadius: 8, boxShadow: `8px 8px 0 ${INK}`, overflow: "hidden" }}>
      <div className="font-display" style={{ height: LIST_HEAD_H, flexShrink: 0, background: INK, color: GOLD, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", fontSize: 30, letterSpacing: 2, textTransform: "uppercase" }}>
        <span>Coming up</span>
        <span className="font-mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "rgba(248,245,236,0.8)" }}>
          Tickets online or at the door
        </span>
      </div>
      {rows.map((s, i) => (
        <Row key={s.id} show={s} now={now} first={i === 0} />
      ))}
      {rows.length <= 2 && <Promo />}
    </section>
  );
}

function Row({ show, now, first }: { show: BoardShow; now: number; first: boolean }) {
  const day = dayLabel(show.startsAt, now);
  const soon = day === "Tonight" || day === "Today";
  return (
    <div style={{ height: ROW_H, flexShrink: 0, display: "flex", alignItems: "center", gap: 28, padding: "0 28px", borderTop: first ? "none" : `2px solid ${RULE}` }}>
      <span
        className="font-display"
        style={{ width: 210, flexShrink: 0, textAlign: "center", fontSize: 26, textTransform: "uppercase", whiteSpace: "nowrap", padding: "8px 0", border: `4px solid ${INK}`, borderRadius: 4, background: soon ? GOLD : "#fff" }}
      >
        {day}
      </span>
      <span className="font-display" style={{ width: 250, flexShrink: 0, fontSize: 48, lineHeight: 1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {clock(show.startsAt)}
      </span>
      <span className="font-display" style={{ flex: 1, minWidth: 0, fontSize: 48, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {show.title}
      </span>
      <span className="font-mono" style={{ flexShrink: 0, maxWidth: 380, fontSize: 26, fontWeight: 700, textTransform: "uppercase", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {show.room}
      </span>
    </div>
  );
}

// Fills the bottom of the board when there's little else on.
function Promo() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 36, padding: "0 28px", borderTop: `2px dashed ${RULE}` }}>
      <span className="ctag ctag-red" style={{ fontSize: 30, padding: "8px 18px", borderWidth: 5 }}>
        Insiders+
      </span>
      <span className="font-display" style={{ fontSize: 44 }}>
        ${RATE_PRICE.adult}/mo · free entry to every screening
      </span>
      <span className="font-mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
        Ask at the counter
      </span>
    </div>
  );
}
