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
