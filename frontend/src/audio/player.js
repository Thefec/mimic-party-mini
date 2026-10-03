import { getAudioContext } from "./audioContext.js";
import { decodeWavBase64 } from "./wav.js";

const buffers = new Map(); // audio base64 -> AudioBuffer
let current = null; // { source, clip, owner, startedAt }

function bufferFor(clip) {
  let buffer = buffers.get(clip.audio);
  if (!buffer) {
    const { sampleRate, samples } = decodeWavBase64(clip.audio);
    buffer = getAudioContext().createBuffer(1, Math.max(1, samples.length), sampleRate);
    buffer.copyToChannel(samples, 0);
    if (buffers.size > 24) buffers.clear();
    buffers.set(clip.audio, buffer);
  }
  return buffer;
}

export function playClip(clip, { owner = null, onEnd } = {}) {
  if (!clip) return;
  stopPlayback();
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = bufferFor(clip);
  source.connect(ctx.destination);
  const entry = { source, clip, owner, startedAt: ctx.currentTime };
  source.onended = () => {
    if (current === entry) current = null;
    onEnd?.();
  };
  source.start();
  current = entry;
}

export function stopPlayback() {
  if (!current) return;
  const c = current;
  current = null;
  try { c.source.stop(); } catch { /* already stopped */ }
}

/** Who is "singing" right now and how loud (from the clip's 25 fps energy curve), for lip-sync. */
export function playbackLevel() {
  if (!current) return { owner: null, level: 0 };
  const frame = Math.floor((getAudioContext().currentTime - current.startedAt) * 25);
  const db = current.clip.features.energy[frame];
  return { owner: current.owner, level: db === undefined ? 0 : Math.min(1, Math.max(0, (db + 50) / 40)) };
}
