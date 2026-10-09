// The M1 Abrams blast on Spend points (SpendPoints.tsx explode): a tiny 2D
// physics step, run once at tap time, then played back as transform-only
// keyframes. Nothing here touches the DOM or the server; it takes boxes in
// and gives keyframes out, the same ones for the same seed.
//
// - Bodies: the tank card's pieces (words, points, icon, button, a few
//   shards), axis-aligned boxes with gravity and spin.
// - Obstacles: the other reward cards' boxes, static. A hard hit is noted
//   (frame and direction) so the card can wobble when the playback gets there.
// - Walls: the screen's edges, floor and ceiling.
// Bodies don't hit each other (cheap, and nobody can tell).

export interface Box {
  x: number; // left, screen px
  y: number; // top
  w: number;
  h: number;
}

export interface BlastPlan {
  // Per body: [dx, dy, rotDeg] at each kept frame, from its rest position.
  tracks: Float32Array[];
  frames: number; // kept frames (FLY_FRAMES / STEP + 1)
  hits: { obstacle: number; frame: number; dx: number; dy: number }[];
}

export const FPS = 60;
export const FLY_FRAMES = 108; // 1.8 s in the air
export const FLY_MS = (FLY_FRAMES / 60) * 1000;
export const STEP = 3; // keep every 3rd frame as a keyframe (20 a second)
const SUB = 2; // substeps a frame, so fast pieces don't tunnel
const GRAVITY = 2600; // px/s²
const BOUNCE = 0.5;
const SCRAPE = 0.8; // sideways speed kept on each wall/floor contact
const HIT_SPEED = 260; // px/s into a card that makes it wobble

// Small seeded PRNG (mulberry32): deterministic, no Math.random.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulate(
  bodies: Box[],
  obstacles: Box[],
  bounds: { w: number; h: number },
  center: { x: number; y: number },
  seed: number,
): BlastPlan {
  const rand = rng(seed);
  const n = bodies.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const r = new Float32Array(n);
  const vr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    x[i] = b.x;
    y[i] = b.y;
    // Straight out from the blast's center, mostly up; light pieces faster.
    const cx = b.x + b.w / 2 - center.x;
    const cy = b.y + b.h / 2 - center.y;
    const a =
      Math.atan2(cy - 40, cx || (rand() - 0.5)) + (rand() - 0.5) * 0.9;
    const light = Math.max(0.55, Math.min(1.25, 60 / Math.sqrt(b.w * b.h)));
    const speed = (1000 + rand() * 900) * light;
    vx[i] = Math.cos(a) * speed;
    vy[i] = Math.sin(a) * speed - 700 - rand() * 500;
    vr[i] = (rand() - 0.5) * 1400 * light;
  }

  const kept = Math.floor(FLY_FRAMES / STEP) + 1;
  const tracks = bodies.map(() => new Float32Array(kept * 3));
  const hits: BlastPlan["hits"] = [];
  const lastHit = new Int32Array(obstacles.length).fill(-999);
  const dt = 1 / FPS / SUB;

  const keep = (f: number) => {
    const k = (f / STEP) * 3;
    for (let i = 0; i < n; i++) {
      tracks[i][k] = x[i] - bodies[i].x;
      tracks[i][k + 1] = y[i] - bodies[i].y;
      tracks[i][k + 2] = r[i];
    }
  };
  keep(0);

  for (let f = 1; f <= FLY_FRAMES; f++) {
    for (let s = 0; s < SUB; s++) {
      for (let i = 0; i < n; i++) {
        const w = bodies[i].w;
        const h = bodies[i].h;
        vy[i] += GRAVITY * dt;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        r[i] += vr[i] * dt;

        // Screen edges.
        if (x[i] < 0) {
          x[i] = 0;
          vx[i] = Math.abs(vx[i]) * BOUNCE;
          vr[i] = -vr[i] * 0.7;
        } else if (x[i] + w > bounds.w) {
          x[i] = bounds.w - w;
          vx[i] = -Math.abs(vx[i]) * BOUNCE;
          vr[i] = -vr[i] * 0.7;
        }
        if (y[i] < 0) {
          y[i] = 0;
          vy[i] = Math.abs(vy[i]) * BOUNCE;
        } else if (y[i] + h > bounds.h) {
          y[i] = bounds.h - h;
          vy[i] = -Math.abs(vy[i]) * BOUNCE;
          if (Math.abs(vy[i]) < 60) vy[i] = 0;
          vx[i] *= SCRAPE;
          vr[i] = vr[i] * 0.6 + vx[i] * 0.4; // roll along the floor
        }

        // The other cards: push out along the shallow side and bounce.
        for (let o = 0; o < obstacles.length; o++) {
          const ob = obstacles[o];
          const px = Math.min(x[i] + w - ob.x, ob.x + ob.w - x[i]);
          const py = Math.min(y[i] + h - ob.y, ob.y + ob.h - y[i]);
          if (px <= 0 || py <= 0) continue;
          let into: number;
          let dx = 0;
          let dy = 0;
          if (px < py) {
            const left = x[i] + w / 2 < ob.x + ob.w / 2;
            x[i] += left ? -px : px;
            into = Math.abs(vx[i]);
            dx = left ? 1 : -1;
            vx[i] = (left ? -1 : 1) * Math.abs(vx[i]) * BOUNCE;
            vy[i] *= SCRAPE;
          } else {
            const above = y[i] + h / 2 < ob.y + ob.h / 2;
            y[i] += above ? -py : py;
            into = Math.abs(vy[i]);
            dy = above ? 1 : -1;
            vy[i] = (above ? -1 : 1) * Math.abs(vy[i]) * BOUNCE;
            if (above && Math.abs(vy[i]) < 60) vy[i] = 0;
            vx[i] *= SCRAPE;
          }
          vr[i] = -vr[i] * 0.6 + (rand() - 0.5) * 300;
          if (into > HIT_SPEED && f - lastHit[o] > 24) {
            lastHit[o] = f;
            const k = Math.min(1, into / 1600);
            hits.push({ obstacle: o, frame: f, dx: dx * k, dy: dy * k });
          }
        }
      }
    }
    vr.forEach((v, i) => (vr[i] = v * 0.995));
    if (f % STEP === 0) keep(f);
  }
  return { tracks, frames: kept, hits };
}

// WAAPI keyframes for one body: the flight, then an eased trip home.
// Times are offsets of the whole animation (flyMs + homeMs).
export function bodyKeyframes(
  track: Float32Array,
  frames: number,
  homeMs: number,
): Keyframe[] {
  const flyMs = FLY_MS;
  const total = flyMs + homeMs;
  const tf = (dx: number, dy: number, rot: number) =>
    `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${rot.toFixed(1)}deg)`;
  const out: Keyframe[] = [];
  for (let k = 0; k < frames; k++) {
    const t = ((k * STEP) / FPS) * 1000;
    out.push({
      offset: Math.min(1, t / total),
      transform: tf(track[k * 3], track[k * 3 + 1], track[k * 3 + 2]),
    });
  }
  // Home: ease in-out from where it landed, unwinding the spin the short way.
  const l = (frames - 1) * 3;
  const lx = track[l];
  const ly = track[l + 1];
  const lr = track[l + 2];
  const upright = Math.round(lr / 360) * 360; // looks the same as 0
  const HOME_STEPS = 10;
  for (let j = 1; j <= HOME_STEPS; j++) {
    const u = j / HOME_STEPS;
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    // Lift off the floor a little on the way, so it reads as flying back.
    const arc = Math.sin(u * Math.PI) * -60;
    out.push({
      offset: Math.min(1, (flyMs + homeMs * u) / total),
      transform: tf(lx * (1 - e), ly * (1 - e) + arc * (1 - e), lr + (upright - lr) * e),
    });
  }
  return out;
}
