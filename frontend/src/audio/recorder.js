import { getAudioContext } from "./audioContext.js";
import { makeClip, MAX_SECONDS } from "./clip.js";
import { getSelectedMicId } from "./devices.js";

// Tap node: forwards every input block to the main thread.
const WORKLET_SRC = `
class MimicTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("mimic-tap", MimicTap);
`;

// Browser voice filters distort loudness and kill non-voice sounds, so they are off.
const CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };

let mic = null; // { stream, source, analyser, tap, sink, deviceId }
let workletLoaded = false;
let recording = null; // { chunks, total, max, rate, resolve }
const levelBuf = new Float32Array(1024);

export const micReady = () => mic !== null;
export const currentMicId = () => mic?.deviceId ?? null;
export const isRecording = () => recording !== null;

async function getStream(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("MIC_UNSUPPORTED");
  const denied = (err) => err?.name === "NotAllowedError" || err?.name === "SecurityError";
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...CONSTRAINTS, deviceId: { exact: deviceId } } : CONSTRAINTS,
    });
  } catch (err) {
    if (denied(err)) throw new Error("MIC_DENIED");
    if (!deviceId) throw new Error("MIC_UNSUPPORTED");
    // The remembered device is gone: fall back to the browser default.
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: CONSTRAINTS });
    } catch (err2) {
      throw new Error(denied(err2) ? "MIC_DENIED" : "MIC_UNSUPPORTED");
    }
  }
}

/** Open (or switch to) a microphone. Keeps it open for instant recording. */
export async function openMic(deviceId = getSelectedMicId()) {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const stream = await getStream(deviceId);
  closeMic();
  if (!workletLoaded) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    workletLoaded = true;
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const tap = new AudioWorkletNode(ctx, "mimic-tap");
  const sink = ctx.createGain();
  sink.gain.value = 0; // keep the graph pulling without making sound
  source.connect(analyser);
  source.connect(tap);
  tap.connect(sink).connect(ctx.destination);
  tap.port.onmessage = (e) => onChunk(e.data);
  mic = { stream, source, analyser, tap, sink, deviceId: stream.getAudioTracks()[0]?.getSettings().deviceId ?? null };
  return mic;
}

export function closeMic() {
  if (!mic) return;
  if (recording) stopRecording();
  mic.tap.port.onmessage = null;
  mic.source.disconnect();
  mic.tap.disconnect();
  mic.sink.disconnect();
  for (const track of mic.stream.getTracks()) track.stop();
  mic = null;
}

/** Current input loudness mapped to 0..1 (-60 dBFS .. -10 dBFS). */
export function micLevel() {
  if (!mic) return 0;
  mic.analyser.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (const v of levelBuf) sum += v * v;
  const db = 20 * Math.log10(Math.max(Math.sqrt(sum / levelBuf.length), 1e-6));
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

/** Resolves with a clip (or null if too quiet/short) when stopped or after MAX_SECONDS. */
export function startRecording() {
  if (!mic) return Promise.reject(new Error("MIC_UNSUPPORTED"));
  if (recording) return recording.promise;
  const rate = getAudioContext().sampleRate;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  recording = { chunks: [], total: 0, max: MAX_SECONDS * rate, rate, resolve, promise };
  return promise;
}

function onChunk(data) {
  if (!recording) return;
  recording.chunks.push(data);
  recording.total += data.length;
  if (recording.total >= recording.max) stopRecording();
}

export function stopRecording() {
  if (!recording) return;
  const r = recording;
  recording = null;
  const all = new Float32Array(r.total);
  let offset = 0;
  for (const c of r.chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  r.resolve(makeClip(all.subarray(0, r.max), r.rate));
}
