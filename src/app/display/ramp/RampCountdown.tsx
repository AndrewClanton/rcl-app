"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rampStateAt, formatCountdown, formatClock, formatDayTime, type RampScreening, type RampState } from "./schedule";

// Designed as a fixed 1080x1920 portrait stage, then scaled to whatever the
// TV reports -- so it looks identical on a 1080p or 4K panel. If the device
// only outputs landscape (common for TV sticks), the stage is rotated 90° to
// stand upright on the physically-rotated screen; ?rotate=ccw flips the
// direction if it comes out upside down, ?rotate=off disables it.
const STAGE_W = 1080;
const STAGE_H = 1920;

// Picks up newly scheduled/edited screenings even if a realtime event is
// missed, and keeps the staff session fresh on a screen nobody touches.
const REFRESH_MS = 5 * 60 * 1000;

const INK = "#14110c";
const INK_CARD = "#211d16";
const INK_RULE = "#3a342b";
const CREAM = "#f8f5ec";
const MUTED = "#a9a293";
const GOLD = "#ffc72c";
const RED = "#ed1c24";

// ---- External stores: the clock and the viewport ---------------------------
// The server's clock is the reference (a cheap TV stick's clock can be off by
// minutes); the offset is refreshed on every server render.
let clockOffset = 0;
const subscribeClock = (cb: () => void) => {
  const id = setInterval(cb, 200);
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

export default function RampCountdown({ screenings, serverNow, rotate }: { screenings: RampScreening[]; serverNow: number; rotate: "cw" | "ccw" | "off" }) {
  const router = useRouter();

  useEffect(() => {
    clockOffset = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("ramp-screenings")
      .on("postgres_changes", { event: "*", schema: "public", table: "screenings" }, () => router.refresh())
      .subscribe();
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(id);
    };
  }, [router]);

  const second = useSyncExternalStore(subscribeClock, getClockSecond, getZero);
  const viewport = useSyncExternalStore(subscribeResize, getViewport, getEmpty);
  const now = second * 1000;
  const state = useMemo(() => rampStateAt(screenings, now), [screenings, now]);

  // Nothing time-dependent renders on the server -- avoids a hydration
  // mismatch and a flash of the wrong countdown.
  if (!second || !viewport) return <div style={{ position: "fixed", inset: 0, background: INK }} />;

  const [vw, vh] = viewport.split("x").map(Number);
  const deg = rotate === "off" || vw <= vh ? 0 : rotate === "ccw" ? -90 : 90;
  const frameW = deg ? vh : vw;
  const frameH = deg ? vw : vh;
  const scale = Math.min(frameW / STAGE_W, frameH / STAGE_H);

  return (
    <div style={{ position: "fixed", inset: 0, background: INK, overflow: "hidden", cursor: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) rotate(${deg}deg) scale(${scale})`,
          display: "flex",
          flexDirection: "column",
          background: INK,
          color: CREAM,
        }}
      >
        <Stage state={state} now={now} />
      </div>
    </div>
  );
}

function Stage({ state, now }: { state: RampState; now: number }) {
  return (
    <>
      <header style={{ height: 130, padding: "0 64px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <Image src="/photos/logo.png" alt="Royale Cinema Lounge" width={216} height={76} priority />
        <div className="font-mono" style={{ fontSize: 44, color: MUTED }}>
          {formatClock(now)}
        </div>
      </header>
      {state.kind === "empty" ? <Empty /> : <Featured state={state} now={now} />}
    </>
  );
}

function Band({ label, background, color }: { label: string; background: string; color: string }) {
  return (
    <div className="font-display" style={{ height: 100, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background, color, fontSize: 60, letterSpacing: 4 }}>
      {label}
    </div>
  );
}

function Featured({ state, now }: { state: Extract<RampState, { featured: RampScreening[] }>; now: number }) {
  const start = state.featured[0].startsAt;
  const untilStart = start - now;
  const countdown = formatCountdown(untilStart);
  const nowPlaying = state.kind === "now-playing";
  const shown = state.featured.slice(0, 2);
  const extra = state.featured.length - shown.length;

  const band = nowPlaying
    ? { label: "NOW PLAYING", background: RED, color: "#ffffff" }
    : countdown
      ? { label: "NEXT UP", background: GOLD, color: INK }
      : { label: "NEXT SCREENING", background: GOLD, color: INK };

  return (
    <>
      <Band {...band} />

      <main style={{ flex: 1, minHeight: 0, padding: "40px 64px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 44 }}>
        {shown.length === 1 ? <Solo film={shown[0]} /> : shown.map((film) => <Row key={film.id} film={film} />)}
        {extra > 0 && (
          <div className="font-display" style={{ fontSize: 40, color: GOLD, textAlign: "center" }}>
            +{extra} MORE STARTING AT {formatClock(start)}
          </div>
        )}
      </main>

      <section style={{ height: 300, flexShrink: 0, borderTop: `3px solid ${INK_RULE}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {nowPlaying ? (
          <>
            <Label>STARTED AT {formatClock(start)}</Label>
            <div className="font-display" style={{ fontSize: 150, lineHeight: 1.1, color: CREAM }}>
              {Math.floor(-untilStart / 60000) === 0 ? "JUST NOW" : `${Math.floor(-untilStart / 60000)} MIN AGO`}
            </div>
          </>
        ) : countdown ? (
          <>
            <Label>{untilStart < 60 * 1000 ? "STARTING NOW" : `STARTS IN · ${formatClock(start)}`}</Label>
            <div className="font-mono" style={{ fontSize: 210, fontWeight: 700, lineHeight: 1, color: GOLD, fontVariantNumeric: "tabular-nums" }}>
              {countdown}
            </div>
          </>
        ) : (
          <>
            <Label>STARTS</Label>
            <div className="font-display" style={{ fontSize: 120, lineHeight: 1.1, color: GOLD }}>
              {formatDayTime(start)}
            </div>
          </>
        )}
      </section>

      <Later state={state} />
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono" style={{ fontSize: 36, fontWeight: 700, letterSpacing: 8, color: MUTED, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function meta(film: RampScreening) {
  return [film.rating, film.runtimeMinutes ? `${film.runtimeMinutes} MIN` : null, film.room.toUpperCase()].filter(Boolean).join(" · ");
}

function titleSize(title: string, base: number) {
  return title.length <= 14 ? base : title.length <= 24 ? Math.round(base * 0.82) : Math.round(base * 0.68);
}

function Poster({ film, width, height }: { film: RampScreening; width: number; height: number }) {
  const frame = { width, height, flexShrink: 0, borderRadius: 10, boxShadow: `14px 14px 0 ${GOLD}`, overflow: "hidden", position: "relative" as const, background: INK_CARD };
  if (!film.posterUrl) {
    return (
      <div className="font-display" style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: 44, color: MUTED }}>
        {film.title}
      </div>
    );
  }
  return (
    <div style={frame}>
      <Image src={film.posterUrl} alt={film.title} fill sizes={`${width}px`} style={{ objectFit: "cover" }} priority />
    </div>
  );
}

function Solo({ film }: { film: RampScreening }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Poster film={film} width={560} height={840} />
      <h1 className="font-display line-clamp-2" style={{ marginTop: 40, fontSize: titleSize(film.title, 88), lineHeight: 1.05, textAlign: "center", textWrap: "balance" }}>
        {film.title}
      </h1>
      <div className="font-mono" style={{ marginTop: 14, fontSize: 32, color: MUTED }}>
        {meta(film)}
      </div>
    </div>
  );
}

function Row({ film }: { film: RampScreening }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
      <Poster film={film} width={320} height={480} />
      <div style={{ minWidth: 0 }}>
        <h2 className="font-display line-clamp-3" style={{ fontSize: titleSize(film.title, 64), lineHeight: 1.05, textWrap: "balance" }}>
          {film.title}
        </h2>
        <div className="font-mono" style={{ marginTop: 14, fontSize: 30, color: MUTED }}>
          {meta(film)}
        </div>
      </div>
    </div>
  );
}

function Later({ state }: { state: Extract<RampState, { later: RampScreening[] }> }) {
  return (
    <footer style={{ height: 230, flexShrink: 0, background: INK_CARD, padding: "30px 64px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
      {state.later.length > 0 ? (
        <>
          <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, letterSpacing: 6, color: MUTED }}>
            {state.laterLabel}
          </div>
          {state.later.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 32 }}>
              <span className="font-display truncate" style={{ fontSize: 42, minWidth: 0 }}>
                {s.title}
              </span>
              <span className="font-mono" style={{ fontSize: 40, fontWeight: 700, color: GOLD, flexShrink: 0 }}>
                {formatClock(s.startsAt)}
              </span>
            </div>
          ))}
        </>
      ) : (
        <Promo />
      )}
    </footer>
  );
}

// Fills the bottom strip when there's nothing else on for the day.
function Promo() {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="font-display" style={{ fontSize: 56, color: GOLD }}>
        INSIDERS+ · $15/MO
      </div>
      <div className="font-mono" style={{ marginTop: 8, fontSize: 30, fontWeight: 700, color: CREAM }}>
        FREE ENTRY TO EVERY SCREENING · ASK AT THE COUNTER
      </div>
    </div>
  );
}

function Empty() {
  return (
    <>
      <Band label="NO SCREENINGS SCHEDULED" background={INK_CARD} color={MUTED} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 48, padding: "0 64px" }}>
        <Image src="/photos/logo.png" alt="" width={860} height={303} />
        <div className="font-display" style={{ fontSize: 64, textAlign: "center", color: CREAM }}>
          micro cinema, third space, film archive
        </div>
      </main>
      <footer style={{ height: 230, flexShrink: 0, background: INK_CARD, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Promo />
      </footer>
    </>
  );
}
