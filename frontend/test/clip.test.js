import { describe, expect, it } from "vitest";
import { validateClip } from "../../backend/src/protocol.ts";
import { makeClip } from "../src/audio/clip.js";
import { decodeWavBase64 } from "../src/audio/wav.js";

const sine = (hz, seconds, rate, amp = 0.4) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const concat = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

describe("makeClip", () => {
  it("resamples 48 kHz input, trims silence, and produces a clip the server accepts", () => {
    const raw = concat(new Float32Array(24000), sine(330, 1, 48000), new Float32Array(24000));
    const clip = makeClip(raw, 48000);
    expect(clip).not.toBeNull();
    const { sampleRate, samples } = decodeWavBase64(clip.audio);
    expect(sampleRate).toBe(16000);
    expect(samples.length).toBeGreaterThanOrEqual(15900);
    expect(samples.length).toBeLessThanOrEqual(16000 + 3 * 160);
    expect(clip.features.pitch.length).toBeGreaterThanOrEqual(24);
    expect(Math.abs(median(clip.features.pitch) - 330) / 330).toBeLessThan(0.02);
    expect(validateClip({ type: "submit_clip", ...clip })).not.toBeNull();
  });

  it("returns null for silence and for sounds shorter than 0.2 s", () => {
    expect(makeClip(new Float32Array(48000), 48000)).toBeNull();
    const blip = concat(new Float32Array(24000), sine(330, 0.1, 48000), new Float32Array(24000));
    expect(makeClip(blip, 48000)).toBeNull();
  });

  it("caps long input at 80 frames and stays under the server's size limit", () => {
    const clip = makeClip(sine(250, 5, 44100), 44100);
    expect(clip.features.energy.length).toBeLessThanOrEqual(80);
    expect(decodeWavBase64(clip.audio).samples.length).toBeLessThanOrEqual(80 * 640);
    expect(validateClip({ type: "submit_clip", ...clip })).not.toBeNull();
  });
});
