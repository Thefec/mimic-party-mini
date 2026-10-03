import { describe, expect, it } from "vitest";
import { lengthFactor, scoreImitation } from "../src/scoring";
import { CLAPS, FALL, HICCUPS, resampleFeatures, RISE, SIREN, SLOPPY_SIREN, synth } from "./fixtures";
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

  it("is generous to a sloppy but recognizable human imitation (>= 70)", () => {
    const r = scoreImitation(SIREN, SLOPPY_SIREN);
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("ranks a close imitation above a poor one", () => {
    const close = scale(resampleFeatures(SIREN, 66), { pitch: 1.3 });
    expect(scoreImitation(SIREN, close).score).toBeGreaterThan(scoreImitation(SIREN, HICCUPS).score + 40);
  });

  it("does not treat a quiet but perfect imitation (peak -38 dBFS) as silence", () => {
    // The client accepts anything above -45 dBFS, so the server must too.
    expect(scoreImitation(SIREN, scale(SIREN, { energyDb: -26 })).score).toBeGreaterThanOrEqual(90);
  });

  it("keeps most of the score when the imitation has a short pause in the middle", () => {
    const pause = { energy: Array(12).fill(-62), pitch: Array(12).fill(0), centroid: Array(12).fill(5500) }; // room noise
    const half = 30;
    const paused = {
      energy: [...SIREN.energy.slice(0, half), ...pause.energy, ...SIREN.energy.slice(half)],
      pitch: [...SIREN.pitch.slice(0, half), ...pause.pitch, ...SIREN.pitch.slice(half)],
      centroid: [...SIREN.centroid.slice(0, half), ...pause.centroid, ...SIREN.centroid.slice(half)],
    };
    const r = scoreImitation(SIREN, paused);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.breakdown.tone).toBeGreaterThanOrEqual(60); // noise in the pause must not wreck the tone
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
