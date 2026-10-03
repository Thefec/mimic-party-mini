import type { Avatar, Clip, Features } from "../src/types";

export const AVATAR: Avatar = { body: 0, color: 0, eyes: 0, hat: 0 };

/** Canonical 44-byte-header 16 kHz mono PCM16 WAV (silence), base64. */
export function makeWavBase64(sampleCount = 1600): string {
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const str = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i); };
  str(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); str(8, "WAVE");
  str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, sampleCount * 2, true);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

type Fn = (x: number) => number;

/** Build a feature sequence by sampling functions of x ∈ [0, 1]. */
export function synth(frames: number, fns: { energy: Fn; pitch: Fn; centroid: Fn }): Features {
  const xs = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : i / (frames - 1)));
  return { energy: xs.map(fns.energy), pitch: xs.map(fns.pitch), centroid: xs.map(fns.centroid) };
}

/** Linear time-stretch of every feature array to `frames` frames. */
export function resampleFeatures(f: Features, frames: number): Features {
  const stretch = (arr: number[]) =>
    Array.from({ length: frames }, (_, i) => {
      const pos = (i / (frames - 1)) * (arr.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(arr.length - 1, lo + 1);
      return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
    });
  return { energy: stretch(f.energy), pitch: stretch(f.pitch), centroid: stretch(f.centroid) };
}

const TAU = Math.PI * 2;

/** Voiced "wee-oo-wee-oo" with steady loudness. */
export const SIREN = synth(60, {
  energy: () => -12,
  pitch: (x) => 300 * 2 ** (0.5 * Math.sin(TAU * 2 * x)),
  centroid: (x) => 1500 + 500 * Math.sin(TAU * 2 * x),
});

/** Four unvoiced claps. */
export const CLAPS = synth(60, {
  energy: (x) => ((x * 4) % 1 < 0.2 ? -8 : -70),
  pitch: () => 0,
  centroid: (x) => ((x * 4) % 1 < 0.2 ? 3000 : 0),
});

/** Three short voiced hiccups with silence in between. */
export const HICCUPS = synth(60, {
  energy: (x) => ((x * 3) % 1 < 0.3 ? -10 : -70),
  pitch: (x) => ((x * 3) % 1 < 0.3 ? 600 : 0),
  centroid: (x) => ((x * 3) % 1 < 0.3 ? 2500 : 0),
});

/** Crescendo with rising pitch. */
export const RISE = synth(60, {
  energy: (x) => -40 + 35 * x,
  pitch: (x) => 200 * 2 ** x,
  centroid: (x) => 800 + 1200 * x,
});

/** Decrescendo with falling pitch. */
export const FALL = synth(60, {
  energy: (x) => -5 - 35 * x,
  pitch: (x) => 400 * 2 ** -x,
  centroid: (x) => 2000 - 1200 * x,
});

/**
 * A sloppy but recognizable human imitation of SIREN: a bit slower, sung higher,
 * pitch wobbling by up to ±1.5 semitones, loudness wobbling by ±5 dB, a brighter
 * voice, and every 5th frame lost by the pitch detector (unvoiced).
 */
export const SLOPPY_SIREN: Features = (() => {
  const base = resampleFeatures(SIREN, 70);
  return {
    energy: base.energy.map((v, i) => Math.min(0, v + 5 * Math.sin(i * 1.7))),
    pitch: base.pitch.map((v, i) => (i % 5 === 4 ? 0 : v * 1.4 * 2 ** ((1.5 * Math.sin(i * 2.3)) / 12))),
    centroid: base.centroid.map((v, i) => v * 1.3 * (1 + 0.15 * Math.sin(i * 1.1))),
  };
})();

export function clip(features: Features = SIREN): Clip {
  return { audio: makeWavBase64(), features };
}
