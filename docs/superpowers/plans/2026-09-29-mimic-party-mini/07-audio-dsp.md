# Task 7: Pure audio processing (resample, trim, features, WAV, clip)

**Files:**
- Create: `frontend/src/audio/resample.js`, `frontend/src/audio/features.js`, `frontend/src/audio/wav.js`, `frontend/src/audio/clip.js`
- Test: `frontend/test/resample.test.js`, `frontend/test/features.test.js`, `frontend/test/wav.test.js`, `frontend/test/clip.test.js`

**Interfaces:**
- Consumes: backend `validateClip`, `isValidWavBase64` (Task 2). These are imported by tests only, to prove the client and server agree on the clip format.
- Produces:
  - `resample.js`: `resample(input: Float32Array, fromRate: number, toRate: number): Float32Array`, `trimSilence(samples: Float32Array, thresholdDb = -45, block = 160): Float32Array`
  - `features.js`: `SAMPLE_RATE = 16000`, `HOP = 640`, `WINDOW = 1024`, `SILENCE_DB = -45`, `frameCount(n)`, `extractFeatures(samples: Float32Array): { energy: number[], pitch: number[], centroid: number[] }`
  - `wav.js`: `encodeWav(samples, sampleRate = 16000): Uint8Array`, `bytesToBase64(bytes)`, `base64ToBytes(b64)`, `encodeWavBase64(samples, sampleRate = 16000)`, `decodeWavBase64(b64): { sampleRate, samples: Float32Array }`
  - `clip.js`: `MAX_SECONDS = 3`, `MAX_FRAMES = 80`, `MIN_SECONDS = 0.2`, `makeClip(raw: Float32Array, rate: number): { audio: string, features } | null`

All of these are pure functions with no browser APIs, so they run in vitest's Node environment.

- [ ] **Step 1: Test helpers inside the tests**

Each test file defines its own tiny signal helpers, so the files stay independent:
```js
const sine = (hz, seconds, rate = 16000, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const concat = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
```

- [ ] **Step 2: Write failing tests**

`frontend/test/resample.test.js`:
```js
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
```

`frontend/test/features.test.js`:
```js
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
```

`frontend/test/wav.test.js`:
```js
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
```

`frontend/test/clip.test.js`:
```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w frontend`
Expected: FAIL — modules under `src/audio/` do not exist.

- [ ] **Step 4: Implement `resample.js`**

`frontend/src/audio/resample.js`:
```js
/** Box-filter resampler: each output sample averages the input samples it covers. */
export function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** Cut leading/trailing blocks quieter than thresholdDb. Keeps 1 block before and 2 after the sound. */
export function trimSilence(samples, thresholdDb = -45, block = 160) {
  const threshold = 10 ** (thresholdDb / 20);
  const blocks = Math.floor(samples.length / block);
  let first = -1;
  let last = -1;
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    for (let i = b * block; i < (b + 1) * block; i++) sum += samples[i] * samples[i];
    if (Math.sqrt(sum / block) > threshold) {
      if (first < 0) first = b;
      last = b;
    }
  }
  if (first < 0) return new Float32Array(0);
  const start = Math.max(0, (first - 1) * block);
  const end = Math.min(samples.length, (last + 3) * block);
  return samples.slice(start, end);
}
```

- [ ] **Step 5: Implement `features.js`**

`frontend/src/audio/features.js`:
```js
export const SAMPLE_RATE = 16000;
export const HOP = 640; // 40 ms -> 25 frames/s
export const WINDOW = 1024;
export const SILENCE_DB = -45;

const YIN_THRESHOLD = 0.15;
const MIN_HZ = 70;
const MAX_HZ = 1000;
const HANN = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));

const round2 = (v) => Math.round(v * 100) / 100;

export function frameCount(sampleCount) {
  return Math.max(1, Math.floor(sampleCount / HOP));
}

export function extractFeatures(samples) {
  const n = frameCount(samples.length);
  const energy = [];
  const pitch = [];
  const centroid = [];
  const frame = new Float32Array(WINDOW);
  for (let i = 0; i < n; i++) {
    const start = i * HOP;
    const valid = Math.max(1, Math.min(WINDOW, samples.length - start));
    frame.fill(0);
    frame.set(samples.subarray(start, start + valid));
    const db = rmsDb(frame, valid);
    energy.push(round2(db));
    pitch.push(db < SILENCE_DB ? 0 : round2(yin(frame)));
    centroid.push(Math.round(spectralCentroid(frame)));
  }
  return { energy, pitch, centroid };
}

function rmsDb(frame, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / length);
  return Math.min(0, Math.max(-120, 20 * Math.log10(Math.max(rms, 1e-6))));
}

/** YIN fundamental frequency estimate, or 0 if unvoiced. */
function yin(x) {
  const W = WINDOW / 2;
  const tauMin = Math.floor(SAMPLE_RATE / MAX_HZ);
  const tauMax = Math.floor(SAMPLE_RATE / MIN_HZ);
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[j] - x[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return 0;
  let refined = tau;
  if (tau > 1 && tau < tauMax) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }
  const hz = SAMPLE_RATE / refined;
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : 0;
}

const re = new Float64Array(WINDOW);
const im = new Float64Array(WINDOW);

function spectralCentroid(x) {
  for (let i = 0; i < WINDOW; i++) {
    re[i] = x[i] * HANN[i];
    im[i] = 0;
  }
  fft(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < WINDOW / 2; k++) {
    const mag = Math.hypot(re[k], im[k]);
    num += mag * ((k * SAMPLE_RATE) / WINDOW);
    den += mag;
  }
  return den > 1e-9 ? Math.min(8000, num / den) : 0;
}

/** In-place iterative radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}
```

- [ ] **Step 6: Implement `wav.js`**

`frontend/src/audio/wav.js`:
```js
export function encodeWav(samples, sampleRate = 16000) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const encodeWavBase64 = (samples, sampleRate = 16000) => bytesToBase64(encodeWav(samples, sampleRate));

/** Decodes the canonical 44-byte-header PCM16 mono WAV produced by encodeWav. */
export function decodeWavBase64(b64) {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer);
  const sampleRate = view.getUint32(24, true);
  const count = view.getUint32(40, true) / 2;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = view.getInt16(44 + i * 2, true);
    samples[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return { sampleRate, samples };
}
```

- [ ] **Step 7: Implement `clip.js`**

`frontend/src/audio/clip.js`:
```js
import { extractFeatures, HOP, SAMPLE_RATE } from "./features.js";
import { resample, trimSilence } from "./resample.js";
import { encodeWavBase64 } from "./wav.js";

export const MAX_SECONDS = 3;
export const MAX_FRAMES = 80;
export const MIN_SECONDS = 0.2;

/**
 * Turn raw mic samples into a submittable clip, or null if there is not
 * enough sound (the UI then says "too quiet / too short").
 */
export function makeClip(raw, rate) {
  const at16k = resample(raw, rate, SAMPLE_RATE);
  const trimmed = trimSilence(at16k);
  if (trimmed.length < MIN_SECONDS * SAMPLE_RATE) return null;
  const samples = trimmed.subarray(0, MAX_FRAMES * HOP);
  return { audio: encodeWavBase64(samples, SAMPLE_RATE), features: extractFeatures(samples) };
}
```

- [ ] **Step 8: Run tests**

Run: `npm test -w frontend`
Expected: PASS.

- If the 110 Hz pitch test fails: 110 Hz needs τ≈145, which is below `tauMax` = 228, so the cause is elsewhere. Check that the frame loop copies `WINDOW` samples, not `HOP`.
- If the `trimSilence` length check fails, re-read the margins: start = `(first-1)*block`, end = `(last+3)*block`. That is 1 block before and 2 after.

- [ ] **Step 9: Checkpoint**

`npm test` (both workspaces) passes. No commit.
