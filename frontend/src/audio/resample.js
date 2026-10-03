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
