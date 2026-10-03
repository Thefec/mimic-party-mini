# Task 3: Similarity scoring

**Files:**
- Create: `backend/src/scoring.ts`
- Test: `backend/test/scoring.test.ts`

**Interfaces:**
- Consumes: `Features`, `Breakdown` from `types.ts` (Task 2); fixtures `SIREN, CLAPS, HICCUPS, RISE, FALL, synth, resampleFeatures` (Task 2).
- Produces: `scoreImitation(original: Features, imitation: Features): { score: number; breakdown: Breakdown }`, `lengthFactor(ratio: number): number`, `K` (calibration constants, exported so tests can report them).

Algorithm: spec §2.3. Summary: normalize each clip, align with DTW inside a Sakoe–Chiba band, average each component along the path, then map to 0–100.

- [ ] **Step 1: Write failing tests**

`backend/test/scoring.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { lengthFactor, scoreImitation } from "../src/scoring";
import { CLAPS, FALL, HICCUPS, resampleFeatures, RISE, SIREN, synth } from "./fixtures";
import type { Features } from "../src/types";

const scale = (f: Features, k: { pitch?: number; centroid?: number; energyDb?: number }): Features => ({
  energy: f.energy.map((v) => Math.min(0, v + (k.energyDb ?? 0))),
  pitch: f.pitch.map((v) => (v > 0 ? v * (k.pitch ?? 1) : 0)),
  centroid: f.centroid.map((v) => v * (k.centroid ?? 1)),
});

describe("scoreImitation", () => {
  it("gives 100 for an identical voiced clip", () => {
    const r = scoreImitation(SIREN, SIREN);
    expect(r.score).toBe(100);
    expect(r.breakdown).toEqual({ rhythm: 100, pitch: 100, tone: 100 });
  });

  it("is key-invariant: an octave higher (with brighter tone) still scores >= 90", () => {
    expect(scoreImitation(SIREN, scale(SIREN, { pitch: 2, centroid: 2 })).score).toBeGreaterThanOrEqual(90);
    expect(scoreImitation(SIREN, scale(SIREN, { pitch: 0.5 })).score).toBeGreaterThanOrEqual(90);
  });

  it("is loudness-invariant: 15 dB quieter still scores >= 90", () => {
    expect(scoreImitation(SIREN, scale(SIREN, { energyDb: -15 })).score).toBeGreaterThanOrEqual(90);
  });

  it("tolerates tempo changes of +-30% (>= 80)", () => {
    expect(scoreImitation(SIREN, resampleFeatures(SIREN, 78)).score).toBeGreaterThanOrEqual(80);
    expect(scoreImitation(SIREN, resampleFeatures(SIREN, 46)).score).toBeGreaterThanOrEqual(80);
  });

  it("scores unrelated sounds <= 35", () => {
    expect(scoreImitation(SIREN, HICCUPS).score).toBeLessThanOrEqual(35);
    expect(scoreImitation(RISE, FALL).score).toBeLessThanOrEqual(35);
    expect(scoreImitation(SIREN, CLAPS).score).toBeLessThanOrEqual(35);
  });

  it("ranks a close imitation above a poor one", () => {
    const close = scale(resampleFeatures(SIREN, 66), { pitch: 1.3 });
    expect(scoreImitation(SIREN, close).score).toBeGreaterThan(scoreImitation(SIREN, HICCUPS).score + 40);
  });

  it("gives 0 to a (near) silent imitation", () => {
    const silent = synth(60, { energy: () => -80, pitch: () => 0, centroid: () => 0 });
    const blip = synth(60, { energy: (x) => (x < 0.05 ? -10 : -80), pitch: () => 0, centroid: () => 0 });
    expect(scoreImitation(SIREN, silent).score).toBe(0);
    expect(scoreImitation(SIREN, blip).score).toBe(0); // 3 loud frames < 5
  });

  it("uses rhythm-weighted scoring (pitch = null) for mostly unvoiced originals", () => {
    const r = scoreImitation(CLAPS, CLAPS);
    expect(r.score).toBe(100);
    expect(r.breakdown.pitch).toBeNull();
    // Same claps, started 3 frames late (a delayed copy, not a phase shift).
    const on = (x: number) => x >= 0.05 && ((x - 0.05) * 4) % 1 < 0.2;
    const delayed = synth(60, { energy: (x) => (on(x) ? -8 : -70), pitch: () => 0, centroid: (x) => (on(x) ? 3000 : 0) });
    expect(scoreImitation(CLAPS, delayed).score).toBeGreaterThanOrEqual(60);
  });

  it("handles single-frame clips without crashing", () => {
    const one = synth(1, { energy: () => -10, pitch: () => 220, centroid: () => 1000 });
    const five = synth(6, { energy: () => -10, pitch: () => 220, centroid: () => 1000 });
    expect(() => scoreImitation(one, five)).not.toThrow();
    expect(scoreImitation(five, five).score).toBe(100);
  });

  it("always returns an integer in [0, 100]", () => {
    for (const [a, b] of [[SIREN, HICCUPS], [RISE, FALL], [CLAPS, SIREN], [HICCUPS, HICCUPS]] as const) {
      const { score } = scoreImitation(a, b);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("lengthFactor", () => {
  it("is 1 inside [0.6, 1.67] and decays linearly to 0.5 at 0.3 / 3.3", () => {
    expect(lengthFactor(1)).toBe(1);
    expect(lengthFactor(0.6)).toBe(1);
    expect(lengthFactor(1.67)).toBe(1);
    expect(lengthFactor(0.45)).toBeCloseTo(0.75, 5);
    expect(lengthFactor(0.3)).toBeCloseTo(0.5, 5);
    expect(lengthFactor(0.1)).toBe(0.5);
    expect(lengthFactor(3.3)).toBeCloseTo(0.5, 5);
    expect(lengthFactor(10)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w backend -- scoring`
Expected: FAIL — cannot resolve `../src/scoring`.

- [ ] **Step 3: Implement `scoring.ts`**

`backend/src/scoring.ts`:
```ts
import type { Breakdown, Features } from "./types";

/** A frame counts as "sound" above this loudness. */
export const LOUD_DB = -35;
/** Imitations with fewer loud frames than this score 0 (0.2 s at 25 fps). */
export const MIN_LOUD_FRAMES = 5;
/** Below this voiced ratio the original is treated as unpitched (claps, clicks). */
export const VOICED_RATIO_FOR_PITCH = 0.2;
/** Calibration: average per-frame distance at which a component's similarity reaches 0. */
export const K = { energy: 0.25, pitch: 0.25, tone: 0.5 };

const W_VOICED = { e: 0.4, p: 0.4, t: 0.2 };
const W_UNVOICED = { e: 0.7, p: 0, t: 0.3 };

interface Prepared {
  e: number[];
  p: (number | null)[];
  t: number[];
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
  const logC = f.centroid.map((c) => Math.log2(Math.max(c, 50)));
  const meanC = logC.reduce((a, b) => a + b, 0) / logC.length;
  return { e, p, t: logC.map((c) => c - meanC), voicedRatio: voiced.length / f.pitch.length };
}

function pitchDist(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null || b === null) return 1;
  return Math.min(Math.abs(a - b) / 12, 1);
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
  const dT = (i: number, j: number) => Math.min(Math.abs(a.t[i] - b.t[j]), 1);
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
```

- [ ] **Step 4: Run tests**

Run: `npm test -w backend -- scoring`
Expected: PASS.

- [ ] **Step 5: Calibrate if needed (only if Step 4 fails on a threshold, not on a crash)**

The only tunable values are `K`. Adjust them in this order, re-running the tests after each change:
- If a **similar** case scores too low (octave, loudness or tempo tests): raise the `K` of the weakest breakdown component by 0.05. Print `scoreImitation(...)` for that case to see which component it is.
- If an **unrelated** case scores too high: lower the `K` of that case's strongest component by 0.05.
- Keep each value within [0.15, 0.6]. If there is no set of values that passes all tests, stop and report the printed breakdowns instead of loosening the test thresholds.

Record the final `K` values in the comment above `K`.

- [ ] **Step 6: Checkpoint**

`npm test -w backend` all pass. No commit.
