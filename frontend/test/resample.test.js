import { describe, expect, it } from "vitest";
import { resample, trimSilence } from "../src/audio/resample.js";

const sine = (hz, seconds, rate = 16000, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const concat = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

describe("resample", () => {
  it("copies when rates match", () => {
    const x = Float32Array.from([1, 2, 3]);
    const y = resample(x, 16000, 16000);
    expect(Array.from(y)).toEqual([1, 2, 3]);
    expect(y).not.toBe(x);
  });

  it("box-averages when downsampling 48k -> 16k", () => {
    const y = resample(Float32Array.from([1, 2, 3, 4, 5, 6]), 48000, 16000);
    expect(Array.from(y)).toEqual([2, 5]);
  });

  it("keeps duration", () => {
    expect(resample(new Float32Array(48000), 48000, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(44100), 44100, 16000)).toHaveLength(16000);
  });
});

describe("trimSilence", () => {
  it("removes leading and trailing silence, keeping a 1-block margin before and 2 after", () => {
    const x = concat(new Float32Array(8000), sine(300, 1), new Float32Array(8000));
    const y = trimSilence(x);
    expect(y.length).toBeGreaterThanOrEqual(16000);
    expect(y.length).toBeLessThanOrEqual(16000 + 3 * 160);
  });

  it("returns an empty array for pure silence or noise below the threshold", () => {
    expect(trimSilence(new Float32Array(16000))).toHaveLength(0);
    expect(trimSilence(sine(300, 1, 16000, 0.001))).toHaveLength(0); // about -63 dBFS
  });
});
