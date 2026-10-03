import { describe, expect, it } from "vitest";
import { isValidWavBase64 } from "../../backend/src/protocol.ts";
import { base64ToBytes, bytesToBase64, decodeWavBase64, encodeWavBase64 } from "../src/audio/wav.js";

describe("wav", () => {
  it("round-trips samples within 16-bit precision", () => {
    const x = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.8);
    const { sampleRate, samples } = decodeWavBase64(encodeWavBase64(x));
    expect(sampleRate).toBe(16000);
    expect(samples).toHaveLength(1000);
    for (let i = 0; i < x.length; i++) expect(Math.abs(samples[i] - x[i])).toBeLessThan(1 / 16000);
  });

  it("clamps out-of-range samples", () => {
    const { samples } = decodeWavBase64(encodeWavBase64(Float32Array.from([2, -2])));
    expect(samples[0]).toBeCloseTo(1, 3);
    expect(samples[1]).toBeCloseTo(-1, 3);
  });

  it("produces the exact header the server validates", () => {
    expect(isValidWavBase64(encodeWavBase64(new Float32Array(16000)))).toBe(true);
  });

  it("base64 helpers handle large buffers", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
