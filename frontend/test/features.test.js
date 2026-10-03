import { describe, expect, it } from "vitest";
import { extractFeatures, frameCount } from "../src/audio/features.js";

const sine = (hz, seconds, rate = 16000, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
function noise(n, amp = 0.3) {
  let seed = 12345;
  return Float32Array.from({ length: n }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return amp * (seed / 1073741824 - 1); });
}

describe("extractFeatures", () => {
  it("produces one frame per 40 ms hop (at least one)", () => {
    expect(frameCount(16000)).toBe(25);
    expect(frameCount(100)).toBe(1);
    const f = extractFeatures(sine(220, 1));
    expect(f.energy).toHaveLength(25);
    expect(f.pitch).toHaveLength(25);
    expect(f.centroid).toHaveLength(25);
  });

  it("finds the pitch of a 220 Hz sine within 2% and its loudness", () => {
    const f = extractFeatures(sine(220, 1));
    expect(Math.abs(median(f.pitch) - 220) / 220).toBeLessThan(0.02);
    expect(median(f.energy)).toBeCloseTo(-9.03, 0);
  });

  it("tracks other pitches too", () => {
    for (const hz of [110, 440, 880]) {
      const p = median(extractFeatures(sine(hz, 0.6)).pitch);
      expect(Math.abs(p - hz) / hz).toBeLessThan(0.02);
    }
  });

  it("reports silence as unvoiced, -120 dB, zero centroid", () => {
    const f = extractFeatures(new Float32Array(16000));
    expect(f.pitch.every((p) => p === 0)).toBe(true);
    expect(f.energy.every((e) => e === -120)).toBe(true);
    expect(f.centroid.every((c) => c === 0)).toBe(true);
  });

  it("reports white noise as mostly unvoiced with a high centroid", () => {
    const f = extractFeatures(noise(16000));
    expect(f.pitch.filter((p) => p === 0).length / f.pitch.length).toBeGreaterThanOrEqual(0.8);
    expect(median(f.centroid)).toBeGreaterThan(2500);
  });

  it("puts the centroid of a 1 kHz sine near 1 kHz", () => {
    const c = median(extractFeatures(sine(1000, 1)).centroid);
    expect(c).toBeGreaterThan(800);
    expect(c).toBeLessThan(1500);
  });

  it("stays inside the ranges the server accepts", () => {
    const f = extractFeatures(noise(16000, 1));
    for (const e of f.energy) expect(e >= -120 && e <= 0).toBe(true);
    for (const p of f.pitch) expect(p === 0 || (p >= 50 && p <= 1200)).toBe(true);
    for (const c of f.centroid) expect(c >= 0 && c <= 8000).toBe(true);
  });
});
