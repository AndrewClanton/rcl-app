// The canvas half of check-in flair (components/flair/FlairEffect.tsx):
// confetti cannons, falling party confetti and fireworks, as tiny particle
// simulations. No libraries; a scene is plain numbers, stepped and drawn
// once a frame, and everything is sized from the canvas itself, so the same
// scene fills the customer screen or a little preview box.
//
// Randomness comes from a seeded generator, so a scene is made the same way
// every time for the same seed (and the physics can be checked from a
// script without a browser).

export type Rand = () => number;

// mulberry32: small, fast, and good enough for scattering confetti.
export function seeded(seed: number): Rand {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: Rand, lo: number, hi: number) => lo + (hi - lo) * rand();

export interface Scene {
  step(dt: number, t: number): void;
  draw(ctx: CanvasRenderingContext2D, t: number): void;
  // One still frame, for reduced motion.
  still(ctx: CanvasRenderingContext2D): void;
}

// ---------- confetti ----------

export interface ConfettiBit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  flip: number; // the paper turning over: drawn squashed by cos(flip)
  vflip: number;
  sway: number;
  vsway: number;
  size: number;
  long: number; // length / width
  round: boolean;
  color: string;
  back: string; // the other side, a little darker
  terminal: number; // falling speed it settles to
  delay: number; // s before it launches
}

export type ConfettiFrom = "cannons" | "top" | "burst";

export interface ConfettiOptions {
  colors: string[];
  backs: string[]; // same order as colors
  count: number;
  from: ConfettiFrom;
  rand: Rand;
  // A gentler version: slower, smaller launches (the profile page header).
  soft?: boolean;
}

// Gravity and air, relative to the height of the box it plays in.
export const CONFETTI_G = 1.25; // x h per s^2

export function makeConfetti(w: number, h: number, o: ConfettiOptions): ConfettiBit[] {
  const { rand } = o;
  const unit = Math.max(4, Math.min(13, Math.min(w, h) * 0.017));
  return Array.from({ length: o.count }, (_, i) => {
    const c = Math.floor(rand() * o.colors.length);
    const bit: ConfettiBit = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      rot: rand() * Math.PI * 2,
      vr: between(rand, -7, 7),
      flip: rand() * Math.PI * 2,
      vflip: between(rand, 5, 13) * (rand() < 0.5 ? -1 : 1),
      sway: rand() * Math.PI * 2,
      vsway: between(rand, 2.5, 5),
      size: unit * between(rand, 0.7, 1.15),
      long: rand() < 0.25 ? between(rand, 2.2, 3.2) : between(rand, 1.2, 1.7),
      round: rand() < 0.14,
      color: o.colors[c],
      back: o.backs[c] ?? o.colors[c],
      terminal: h * between(rand, 0.2, 0.34) * (o.soft ? 0.8 : 1),
      delay: 0,
    };
    if (o.from === "cannons") {
      // Two cannons in the bottom corners, aimed up and inward.
      const left = i % 2 === 0;
      const tilt = between(rand, 0.08, 0.8); // radians off vertical
      const speed = h * between(rand, 1.35, 2.2) * (o.soft ? 0.72 : 1);
      bit.x = (left ? w * 0.02 : w * 0.98) + between(rand, -0.02, 0.02) * w;
      bit.y = h + unit * 2;
      bit.vx = Math.sin(tilt) * speed * (left ? 1 : -1);
      bit.vy = -Math.cos(tilt) * speed;
      bit.delay = between(rand, 0, 0.28) + (i % 4 === 3 ? 0.22 : 0);
    } else if (o.from === "burst") {
      const a = -Math.PI / 2 + between(rand, -1.25, 1.25);
      const speed = h * between(rand, 0.55, 1.35) * (o.soft ? 0.75 : 1);
      bit.x = w * 0.5;
      bit.y = h * 0.62;
      bit.vx = Math.cos(a) * speed;
      bit.vy = Math.sin(a) * speed;
      bit.delay = between(rand, 0, 0.12);
    } else {
      // Rain from above, spread over the first second or so.
      bit.x = rand() * w;
      bit.y = -unit * 3;
      bit.vx = between(rand, -0.08, 0.08) * h;
      bit.vy = between(rand, 0.05, 0.25) * h;
      bit.delay = between(rand, 0, 1.1);
    }
    return bit;
  });
}

// One step of a piece's flight: fast and nearly ballistic on the way up,
// then caught by the air, settling to a slow, swaying fall.
export function stepConfetti(b: ConfettiBit, dt: number, h: number): void {
  if (b.delay > 0) {
    b.delay -= dt;
    return;
  }
  const g = CONFETTI_G * h;
  if (b.vy < 0) {
    b.vx *= Math.exp(-1.1 * dt);
    b.vy = b.vy * Math.exp(-0.9 * dt) + g * dt;
  } else {
    b.vy += g * dt;
    if (b.vy > b.terminal) b.vy += (b.terminal - b.vy) * (1 - Math.exp(-6 * dt));
    b.vx *= Math.exp(-2.2 * dt);
    b.sway += b.vsway * dt;
    b.x += Math.sin(b.sway) * h * 0.1 * dt;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.rot += b.vr * dt;
  b.flip += b.vflip * dt;
}

function drawBit(ctx: CanvasRenderingContext2D, b: ConfettiBit) {
  const c = Math.cos(b.flip);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot);
  ctx.scale(1, Math.abs(c) < 0.08 ? 0.08 : Math.abs(c));
  ctx.fillStyle = c >= 0 ? b.color : b.back;
  if (b.round) {
    ctx.beginPath();
    ctx.arc(0, 0, b.size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(-b.size / 2, (-b.size * b.long) / 2, b.size, b.size * b.long);
  }
  ctx.restore();
}

export function confettiScene(w: number, h: number, o: ConfettiOptions): Scene {
  const bits = makeConfetti(w, h, o);
  return {
    step(dt) {
      for (const b of bits) stepConfetti(b, dt, h);
    },
    draw(ctx) {
      for (const b of bits) if (b.delay <= 0 && b.y < h + 40) drawBit(ctx, b);
    },
    still(ctx) {
      // Scattered where it would be mid-flight, not moving.
      for (const b of bits) {
        b.x = o.rand() * w;
        b.y = o.rand() * h * 0.85;
        drawBit(ctx, b);
      }
    },
  };
}

// ---------- fireworks ----------

interface Spark {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  color: string;
  twinkle: boolean;
}

interface Rocket {
  at: number; // s after the start
  x: number;
  y: number;
  fromY: number;
  toY: number;
  rise: number; // s
  color: string;
  size: number; // burst radius, px
  launched: boolean;
  burst: boolean;
  flash: number;
}

export interface FireworkOptions {
  colors: string[]; // burst colors, theirs first
  rockets: number;
  rand: Rand;
  soft?: boolean;
}

export function fireworksScene(w: number, h: number, o: FireworkOptions): Scene {
  const { rand } = o;
  const radius = Math.min(w, h) * (o.soft ? 0.2 : 0.26);
  const dot = Math.max(1.3, Math.min(w, h) * 0.0042);
  const rockets: Rocket[] = Array.from({ length: o.rockets }, (_, i) => ({
    at: i * (o.soft ? 0.6 : 0.42) + between(rand, 0, 0.12),
    x: w * (o.rockets === 1 ? 0.5 : between(rand, 0.18, 0.82)),
    y: h + 6,
    fromY: h + 6,
    toY: h * between(rand, 0.16, o.soft ? 0.4 : 0.42),
    rise: between(rand, 0.5, 0.68),
    // Theirs every other burst, then the others in turn.
    color: i % 2 === 0 ? o.colors[0] : o.colors[1 + ((i >> 1) % Math.max(1, o.colors.length - 1))] ?? o.colors[0],
    size: radius * between(rand, 0.75, 1.05),
    launched: false,
    burst: false,
    flash: 0,
  }));
  const sparks: Spark[] = [];
  const trail: Spark[] = [];
  const g = h * 0.32;

  function explode(r: Rocket) {
    r.burst = true;
    r.flash = 1;
    const n = o.soft ? 40 : 76;
    const ring = rand() < 0.35; // some bursts are a clean ring
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + between(rand, -0.05, 0.05);
      const speed = (r.size / 0.62) * (ring ? between(rand, 0.9, 1) : Math.sqrt(rand()) * between(rand, 0.85, 1.05));
      const second = i % 5 === 0 && o.colors.length > 1;
      sparks.push({
        x: r.x,
        y: r.y,
        px: r.x,
        py: r.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: between(rand, 1.05, 1.5),
        age: 0,
        color: second ? "#ffffff" : r.color,
        twinkle: rand() < 0.3,
      });
    }
  }

  return {
    step(dt, t) {
      for (const r of rockets) {
        if (r.burst || t < r.at) continue;
        r.launched = true;
        const p = Math.min(1, (t - r.at) / r.rise);
        const eased = 1 - (1 - p) * (1 - p);
        const prevY = r.y;
        r.y = r.fromY + (r.toY - r.fromY) * eased;
        trail.push({ x: r.x + between(rand, -1, 1), y: prevY, px: r.x, py: prevY, vx: between(rand, -8, 8), vy: between(rand, 10, 30), life: 0.35, age: 0, color: "#ffe9a8", twinkle: false });
        if (p >= 1) explode(r);
      }
      for (const r of rockets) r.flash = Math.max(0, r.flash - dt * 5);
      for (const list of [sparks, trail]) {
        for (const s of list) {
          s.age += dt;
          s.px = s.x;
          s.py = s.y;
          s.vx *= Math.exp(-2.1 * dt);
          s.vy = s.vy * Math.exp(-2.1 * dt) + g * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
        }
      }
      for (const list of [sparks, trail]) {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].age >= list[i].life) list.splice(i, 1);
      }
    },
    draw(ctx, t) {
      const base = ctx.globalAlpha; // the loop's fade-out
      ctx.globalCompositeOperation = "lighter";
      for (const r of rockets) {
        if (r.flash > 0) {
          const grad = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.size * 0.9);
          grad.addColorStop(0, `rgba(255,255,255,${0.35 * r.flash})`);
          grad.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(r.x - r.size, r.y - r.size, r.size * 2, r.size * 2);
        }
        if (r.launched && !r.burst) {
          ctx.fillStyle = "#fff6d8";
          ctx.beginPath();
          ctx.arc(r.x, r.y, dot * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.lineCap = "round";
      for (const list of [trail, sparks]) {
        for (const s of list) {
          const left = 1 - s.age / s.life;
          let a = Math.min(1, left * 1.6);
          if (s.twinkle && left < 0.6) a *= 0.35 + 0.65 * Math.abs(Math.sin(t * 38 + s.x));
          ctx.globalAlpha = base * a;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = dot * (list === trail ? 1 : 1.5);
          ctx.beginPath();
          ctx.moveTo(s.px, s.py);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          ctx.globalAlpha = base * a * 0.22;
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, dot * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = base;
      ctx.globalCompositeOperation = "source-over";
    },
    still(ctx) {
      // Two bursts drawn as rays, frozen.
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const r of rockets.slice(0, 2)) {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          ctx.strokeStyle = i % 5 === 0 ? "#ffffff" : r.color;
          ctx.lineWidth = dot * 1.5;
          ctx.beginPath();
          ctx.moveTo(r.x + Math.cos(a) * r.size * 0.35, r.toY + Math.sin(a) * r.size * 0.35);
          ctx.lineTo(r.x + Math.cos(a) * r.size * 0.8, r.toY + Math.sin(a) * r.size * 0.8);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
}

// ---------- the loop ----------

// Plays a scene on a canvas for `ms`, fading out over the last `fadeMs`,
// then clears it. Reduced motion: one still frame (the layer's CSS fades
// it). Returns a stop function.
export function playScene(canvas: HTMLCanvasElement, make: (w: number, h: number) => Scene, o: { ms: number; fadeMs?: number; reduced: boolean }): () => void {
  const ctx = canvas.getContext("2d");
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!ctx || !w || !h) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scene = make(w, h);
  if (o.reduced) {
    scene.still(ctx);
    return () => ctx.clearRect(0, 0, w, h);
  }
  const fade = o.fadeMs ?? 600;
  let raf = 0;
  let start = 0;
  let last = 0;
  const frame = (now: number) => {
    if (!start) start = last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    if (elapsed >= o.ms) return;
    scene.step(dt, elapsed / 1000);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (o.ms - elapsed) / fade);
    scene.draw(ctx, elapsed / 1000);
    ctx.restore();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, w, h);
  };
}
