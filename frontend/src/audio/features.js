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
