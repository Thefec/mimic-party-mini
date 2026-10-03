import type { Breakdown, Features } from "./types";

/**
 * A frame counts as "sound" above this loudness. Must match the client's silence threshold
 * (frontend/src/audio/features.js SILENCE_DB): anything the client accepts must not be "silent" here.
 */
export const LOUD_DB = -45;
/** Imitations with fewer loud frames than this score 0 (0.2 s at 25 fps). */
export const MIN_LOUD_FRAMES = 5;
/** Below this voiced ratio the original is treated as unpitched (claps, clicks). */
export const VOICED_RATIO_FOR_PITCH = 0.2;
/**
 * Calibration: average per-frame distance at which a component's similarity reaches 0.
 * Tuned so a sloppy-but-recognizable imitation scores ~76 while unrelated sounds stay <= ~15
 * (see test/scoring.test.ts). Raise a value to make that component more forgiving.
 */
export const K = { energy: 0.45, pitch: 0.45, tone: 0.7 };
/**
 * Pitch distance when only one of two aligned frames is voiced. Real pitch detectors
 * drop frames of breathy/noisy voices, so this is a partial penalty, not a full miss.
 */
export const VOICING_MISMATCH = { cost: 0.3 };

const W_VOICED = { e: 0.4, p: 0.4, t: 0.2 };
const W_UNVOICED = { e: 0.7, p: 0, t: 0.3 };

/** Frames this far below the clip's peak are pauses/room noise: they carry no tone information. */
export const QUIET_BELOW_PEAK_DB = 30;

interface Prepared {
  e: number[];
  p: (number | null)[];
  t: (number | null)[]; // null = quiet frame
  voicedRatio: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function prepare(f: Features): Prepared {
  const maxE = Math.max(...f.energy);
  const e = f.energy.map((v) => (Math.min(0, Math.max(-40, v - maxE)) + 40) / 40);
  const voiced = f.pitch.filter((v) => v > 0);
  const ref = voiced.length ? median(voiced) : 1;
  const p = f.pitch.map((v) => (v > 0 ? 12 * Math.log2(v / ref) : null));
  // Tone (brightness) only means something where there is sound; pauses would be room noise.
  const quiet = f.energy.map((v) => v - maxE < -QUIET_BELOW_PEAK_DB || v < LOUD_DB);
  const logC = f.centroid.map((c) => Math.log2(Math.max(c, 50)));
  const active = logC.filter((_, i) => !quiet[i]);
  const meanC = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0;
  const t = logC.map((c, i) => (quiet[i] ? null : c - meanC));
  return { e, p, t, voicedRatio: voiced.length / f.pitch.length };
}

function pitchDist(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null || b === null) return VOICING_MISMATCH.cost;
  return Math.min(Math.abs(a - b) / 12, 1);
}

function toneDist(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null || b === null) return VOICING_MISMATCH.cost; // sound vs pause: rhythm already penalizes it
  return Math.min(Math.abs(a - b), 1);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function lengthFactor(ratio: number): number {
  if (ratio >= 0.6 && ratio <= 1.67) return 1;
  if (ratio < 0.6) return Math.max(0.5, 1 - ((0.6 - ratio) / 0.3) * 0.5);
  return Math.max(0.5, 1 - ((ratio - 1.67) / (3.3 - 1.67)) * 0.5);
}

export function scoreImitation(original: Features, imitation: Features): { score: number; breakdown: Breakdown } {
  const a = prepare(original);
  const b = prepare(imitation);
  const usePitch = a.voicedRatio >= VOICED_RATIO_FOR_PITCH;
  const w = usePitch ? W_VOICED : W_UNVOICED;

  const loud = imitation.energy.filter((v) => v > LOUD_DB).length;
  if (loud < MIN_LOUD_FRAMES) {
    return { score: 0, breakdown: { rhythm: 0, pitch: usePitch ? 0 : null, tone: 0 } };
  }

  const n = a.e.length;
  const m = b.e.length;
  const dE = (i: number, j: number) => Math.abs(a.e[i] - b.e[j]);
  const dP = (i: number, j: number) => pitchDist(a.p[i], b.p[j]);
  const dT = (i: number, j: number) => toneDist(a.t[i], b.t[j]);
  const d = (i: number, j: number) => w.e * dE(i, j) + w.p * dP(i, j) + w.t * dT(i, j);

  // DTW over a band around the (scaled) diagonal. cost is (n+1)x(m+1), 1-based.
  const band = Math.max(1, Math.ceil(0.3 * Math.max(n, m)), Math.abs(n - m));
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Infinity);
  cost[0] = 0;
  for (let i = 1; i <= n; i++) {
    const center = (i * m) / n;
    const lo = Math.max(1, Math.ceil(center - band));
    const hi = Math.min(m, Math.floor(center + band));
    for (let j = lo; j <= hi; j++) {
      const best = Math.min(cost[(i - 1) * W + (j - 1)], cost[(i - 1) * W + j], cost[i * W + (j - 1)]);
      cost[i * W + j] = d(i - 1, j - 1) + best;
    }
  }

  // Backtrack from (n, m), averaging each component along the path.
  let i = n, j = m, steps = 0, sumE = 0, sumP = 0, sumT = 0;
  while (i > 0 && j > 0) {
    sumE += dE(i - 1, j - 1);
    sumP += dP(i - 1, j - 1);
    sumT += dT(i - 1, j - 1);
    steps++;
    if (i === 1 && j === 1) break;
    const diag = i > 1 && j > 1 ? cost[(i - 1) * W + (j - 1)] : Infinity;
    const up = i > 1 ? cost[(i - 1) * W + j] : Infinity;
    const left = j > 1 ? cost[i * W + (j - 1)] : Infinity;
    if (diag <= up && diag <= left) { i--; j--; }
    else if (up <= left) i--;
    else j--;
  }

  const sE = clamp01(1 - sumE / steps / K.energy);
  const sP = usePitch ? clamp01(1 - sumP / steps / K.pitch) : 0;
  const sT = clamp01(1 - sumT / steps / K.tone);
  const raw = w.e * sE + w.p * sP + w.t * sT;
  const score = Math.round(100 * clamp01(raw * lengthFactor(m / n)));

  return {
    score,
    breakdown: {
      rhythm: Math.round(100 * sE),
      pitch: usePitch ? Math.round(100 * sP) : null,
      tone: Math.round(100 * sT),
    },
  };
}
