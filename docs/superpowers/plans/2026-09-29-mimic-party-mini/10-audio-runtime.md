# Task 10: Audio runtime, mic panel, recorder widget, audio lab

**Files:**
- Create: `frontend/src/audio/audioContext.js`, `frontend/src/audio/devices.js`, `frontend/src/audio/recorder.js`, `frontend/src/audio/player.js`, `frontend/src/audio/sfx.js`
- Create: `frontend/src/ui/micPanel.js`, `frontend/src/ui/recorderWidget.js`
- Create: `frontend/prototype/audio.html`, `frontend/prototype/audio.js` (dev-only lab page)

**Interfaces:**
- Consumes: `makeClip`, `MAX_SECONDS` (Task 7); `decodeWavBase64` (Task 7); `h` (Task 8); `T` (Task 9); `loadPref`, `savePref`, `PREF_MIC` (Task 9); `showError` (Task 9); backend `scoreImitation` (Task 3, lab page only).
- Produces:
  - `audioContext.js`: `getAudioContext()`, `unlockAudio()` (call inside a click handler)
  - `devices.js`: `listMics() → Promise<MediaDeviceInfo[]>`, `getSelectedMicId()`, `setSelectedMicId(id)`, `onMicsChanged(fn) → unsubscribe`
  - `recorder.js`: `openMic(deviceId?) → Promise` (throws `Error("MIC_DENIED" | "MIC_UNSUPPORTED")`), `closeMic()`, `micReady()`, `currentMicId()`, `micLevel() → 0..1`, `startRecording() → Promise<clip | null>`, `stopRecording()`, `isRecording()`
  - `player.js`: `playClip(clip, { owner?, onEnd? })`, `stopPlayback()`, `playbackLevel() → { owner, level }`
  - `sfx.js`: `sfx.tick()`, `sfx.pop()`, `sfx.whoosh()`, `sfx.ding()`, `sfx.fanfare()`. All are silent while recording.
  - `micPanel.js`: `createMicPanel() → { el, destroy() }`
  - `recorderWidget.js`: `createRecorderWidget({ onSubmit(clip), owner?, keys = true, beforeRecord? }) → { el, markAccepted(), checkResend(), destroy() }`

This task uses browser-only APIs (getUserMedia, AudioWorklet, Web Audio), so it is verified manually on the audio lab page. The lab page also lets you check scoring with real voices before the game exists.

- [ ] **Step 1: Audio context and devices**

`frontend/src/audio/audioContext.js`:
```js
let ctx = null;

export function getAudioContext() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Browsers start audio suspended; call this from a click/keydown handler. */
export async function unlockAudio() {
  const c = getAudioContext();
  if (c.state === "suspended") await c.resume();
}
```

`frontend/src/audio/devices.js`:
```js
import { loadPref, PREF_MIC, savePref } from "../prefs.js";

/** Audio inputs. Labels are only filled in after mic permission was granted. */
export async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput" && d.deviceId);
}

export const getSelectedMicId = () => loadPref(PREF_MIC, null);
export const setSelectedMicId = (id) => savePref(PREF_MIC, id);

export function onMicsChanged(fn) {
  const md = navigator.mediaDevices;
  if (!md?.addEventListener) return () => {};
  md.addEventListener("devicechange", fn);
  return () => md.removeEventListener("devicechange", fn);
}
```

- [ ] **Step 2: Recorder**

`frontend/src/audio/recorder.js`:
```js
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
```

- [ ] **Step 3: Playback and sound effects**

`frontend/src/audio/player.js`:
```js
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
```

`frontend/src/audio/sfx.js`:
```js
import { getAudioContext } from "./audioContext.js";
import { isRecording } from "./recorder.js";

function tone(freq, duration, { type = "sine", gain = 0.12, delay = 0, slide = 0 } = {}) {
  if (isRecording()) return; // never leak effects into a recording
  const ctx = getAudioContext();
  if (ctx.state !== "running") return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t0 + duration);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sfx = {
  tick: () => tone(880, 0.06, { type: "square", gain: 0.04 }),
  pop: () => tone(520, 0.12, { slide: 1.8 }),
  whoosh: () => tone(200, 0.35, { type: "sawtooth", gain: 0.04, slide: 4 }),
  ding: () => { tone(988, 0.25); tone(1319, 0.35, { delay: 0.08 }); },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: "triangle", delay: i * 0.12 })),
};
```

- [ ] **Step 4: Mic panel**

`frontend/src/ui/micPanel.js`:
```js
import { currentMicId, isRecording, micLevel, micReady, openMic } from "../audio/recorder.js";
import { listMics, onMicsChanged, setSelectedMicId } from "../audio/devices.js";
import { T } from "../strings.js";
import { h } from "./dom.js";

/** Permission button -> device dropdown + live level meter. Reusable in lobby and game. */
export function createMicPanel() {
  const testBtn = h("button", { class: "btn", onclick: enable }, "🎙️ " + T.mic.test);
  const select = h("select", { class: "input", title: T.mic.select, onchange: onSelect });
  const fill = h("div", { class: "meter-fill" });
  const meter = h("div", { class: "meter" }, fill);
  const msg = h("div", { class: "muted small" });
  const el = h("div", { class: "mic-panel" }, h("div", { class: "label" }, T.mic.title), testBtn, select, meter, msg);

  let raf = 0;
  const offDevices = onMicsChanged(() => refresh());

  function showErr(err) {
    msg.textContent = err?.message === "MIC_DENIED" ? T.mic.denied : T.mic.unsupported;
  }

  async function enable() {
    try {
      await openMic();
      await refresh();
    } catch (err) {
      showErr(err);
    }
  }

  async function onSelect() {
    setSelectedMicId(select.value);
    try {
      await openMic(select.value);
      await refresh();
    } catch (err) {
      showErr(err);
    }
  }

  async function refresh() {
    const ready = micReady();
    testBtn.hidden = ready;
    meter.hidden = !ready;
    if (!ready) {
      select.hidden = true;
      return;
    }
    const mics = await listMics();
    select.replaceChildren(...mics.map((d, i) => h("option", { value: d.deviceId }, d.label || `${T.mic.select} ${i + 1}`)));
    select.value = currentMicId() ?? "";
    select.hidden = mics.length < 2;
    msg.textContent = "";
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    fill.style.width = `${Math.round(micLevel() * 100)}%`;
    select.disabled = isRecording();
  }

  refresh();
  loop();
  return {
    el,
    destroy() {
      cancelAnimationFrame(raf);
      offDevices();
    },
  };
}
```

- [ ] **Step 5: Recorder widget**

`frontend/src/ui/recorderWidget.js`:
```js
import { isRecording, micLevel, micReady, openMic, startRecording, stopRecording } from "../audio/recorder.js";
import { playClip, stopPlayback } from "../audio/player.js";
import { showError } from "../state.js";
import { T } from "../strings.js";
import { h } from "./dom.js";

const RESEND_AFTER_MS = 3000;

/**
 * Record -> (listen) -> send. States: idle | recording | recorded | sent.
 * Space toggles recording and Enter sends (unless typing in a field).
 */
export function createRecorderWidget({ onSubmit, owner = null, keys = true, beforeRecord } = {}) {
  let mode = "idle";
  let clip = null;
  let sentAt = 0;
  let raf = 0;

  // mousedown preventDefault keeps focus off the buttons, so Space never "clicks" them twice.
  const noFocus = (e) => e.preventDefault();
  const recBtn = h("button", { class: "btn record big", onmousedown: noFocus, onclick: toggle });
  const playBtn = h("button", { class: "btn", onmousedown: noFocus, onclick: () => playClip(clip, { owner }) }, "▶ " + T.game.play);
  const sendBtn = h("button", { class: "btn primary", onmousedown: noFocus, onclick: submit }, T.game.send);
  const fill = h("div", { class: "meter-fill" });
  const status = h("div", { class: "muted" });
  const el = h(
    "div",
    { class: "recorder" },
    recBtn,
    h("div", { class: "meter" }, fill),
    h("div", { class: "row" }, playBtn, sendBtn),
    status,
    keys ? h("div", { class: "hint" }, T.game.keysHint) : null,
  );

  async function toggle() {
    if (mode === "sent") return;
    if (mode === "recording") {
      stopRecording();
      return;
    }
    try {
      if (!micReady()) await openMic();
    } catch (err) {
      showError(err.message);
      return;
    }
    beforeRecord?.();
    stopPlayback();
    mode = "recording";
    status.textContent = "";
    render();
    const result = await startRecording();
    if (mode !== "recording") return; // destroyed or reset meanwhile
    clip = result ?? clip;
    mode = clip ? "recorded" : "idle";
    status.textContent = result ? "" : T.game.tooQuiet;
    render();
  }

  function submit() {
    if (mode !== "recorded" || !clip) return;
    stopPlayback();
    mode = "sent";
    sentAt = Date.now();
    render();
    onSubmit(clip);
  }

  function render() {
    recBtn.textContent = mode === "recording" ? "■ " + T.game.stop : clip ? "● " + T.game.rerecord : "● " + T.game.record;
    recBtn.classList.toggle("recording", mode === "recording");
    recBtn.disabled = mode === "sent";
    playBtn.disabled = !clip || mode === "recording";
    sendBtn.disabled = mode !== "recorded";
    if (mode === "sent") status.textContent = T.game.sent;
  }

  function onKey(e) {
    if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      toggle();
    } else if (e.code === "Enter") {
      e.preventDefault();
      submit();
    }
  }
  if (keys) window.addEventListener("keydown", onKey);

  function loop() {
    raf = requestAnimationFrame(loop);
    fill.style.width = `${Math.round((mode === "recording" ? micLevel() : 0) * 100)}%`;
  }

  render();
  loop();
  return {
    el,
    /** The server confirmed our submission. */
    markAccepted() {
      if (mode !== "sent") {
        mode = "sent";
        render();
      }
    },
    /** No confirmation after a while (e.g. the server rejected it): allow sending again. */
    checkResend() {
      if (mode === "sent" && Date.now() - sentAt > RESEND_AFTER_MS) {
        mode = "recorded";
        status.textContent = "";
        render();
      }
    },
    destroy() {
      if (keys) window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      if (isRecording()) stopRecording();
      mode = "destroyed";
    },
  };
}
```

- [ ] **Step 6: Audio lab page (dev only)**

`frontend/prototype/audio.html`:
```html
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Mimic Party Mini — ses laboratuvarı</title>
<!--STYLE-->
<style>
  body { padding: 24px; font: 15px system-ui; overflow: auto; }
  .lab { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: 16px; max-width: 1100px; }
  .card { background: #3a2d63; border-radius: 14px; padding: 16px; }
  .meter { height: 10px; background: #0003; border-radius: 6px; overflow: hidden; margin: 8px 0; }
  .meter-fill { height: 100%; background: #7bd389; width: 0; }
  .btn { margin: 4px 4px 4px 0; padding: 8px 12px; border-radius: 8px; border: 0; cursor: pointer; font-weight: 700; }
  pre { white-space: pre-wrap; font-size: 12px; }
</style>
</head>
<body>
<h1>Ses laboratuvarı</h1>
<p>Önce mikrofonu aç, sonra bir "orijinal" ve bir "taklit" kaydet. Puan, sunucunun kullandığı algoritmayla hesaplanır.</p>
<div class="lab" id="lab"></div>
<!--SCRIPT-->
</body>
</html>
```

`frontend/prototype/audio.js`:
```js
import { scoreImitation } from "../../backend/src/scoring.ts";
import { unlockAudio } from "../src/audio/audioContext.js";
import { h } from "../src/ui/dom.js";
import { createMicPanel } from "../src/ui/micPanel.js";
import { createRecorderWidget } from "../src/ui/recorderWidget.js";
import { subscribe } from "../src/state.js";

const lab = document.getElementById("lab");
const result = h("pre", {}, "—");
const clips = { original: null, imitation: null };

document.addEventListener("click", () => unlockAudio(), { once: true });
subscribe((s) => { if (s.local.error) result.textContent = `Hata: ${s.local.error}`; });

function describe(clip) {
  const f = clip.features;
  const voiced = f.pitch.filter((p) => p > 0);
  return `${f.energy.length} kare (${(f.energy.length / 25).toFixed(2)} s), sesli kare: ${voiced.length}, ` +
    `medyan perde: ${voiced.length ? Math.round([...voiced].sort((a, b) => a - b)[voiced.length >> 1]) : 0} Hz, ` +
    `boyut: ${Math.round((clip.audio.length * 3) / 4 / 1024)} KB`;
}

function update() {
  if (!clips.original || !clips.imitation) return;
  const r = scoreImitation(clips.original.features, clips.imitation.features);
  result.textContent = `PUAN: ${r.score}\nritim ${r.breakdown.rhythm} · melodi ${r.breakdown.pitch ?? "—"} · tını ${r.breakdown.tone}\n\n` +
    `orijinal: ${describe(clips.original)}\ntaklit:   ${describe(clips.imitation)}`;
}

function card(title, key) {
  let widget;
  const make = () => createRecorderWidget({
    keys: false,
    onSubmit: (clip) => {
      clips[key] = clip;
      update();
      // allow re-recording in the lab
      setTimeout(() => { widget.destroy(); widget = make(); slot.replaceChildren(widget.el); }, 300);
    },
  });
  const slot = h("div");
  widget = make();
  slot.append(widget.el);
  return h("div", { class: "card" }, h("h2", {}, title), slot);
}

lab.append(
  h("div", { class: "card" }, createMicPanel().el),
  card("Orijinal", "original"),
  card("Taklit", "imitation"),
  h("div", { class: "card", style: "grid-column: 1 / -1" }, h("h2", {}, "Sonuç"), result),
);
```

- [ ] **Step 7: Build and verify manually**

Run: `npm run audiolab -w frontend`
Expected: `built prototype\dist\audio.html`.

Serve it from localhost, because mic access needs a secure context. From `C:\Users\Batu\Desktop\mimic\frontend\prototype\dist` run `npx http-server -p 5173 -c-1`, then open `http://localhost:5173/audio.html`. (`file://` also works in Chrome, but localhost behaves like production.)

Check each of these:
1. "Mikrofonu test et" → the browser asks for permission → the level meter moves when you speak. With 2+ mics, a dropdown with real names appears. Switching mics makes the meter follow the newly selected mic. Reload the page and enable again: the chosen mic is used.
2. Record an original (for example "wee-oo" siren, about 2 s) and "Gönder". Then record the same sound as the imitation and "Gönder". The score should usually be **≥ 70**.
3. Record a clearly different sound as the imitation (for example three claps). The score should usually be **≤ 35**.
4. Record near-silence: the widget says "Ses çok kısa ya da çok sessiz".
5. Recording auto-stops at 3 s, and "Dinle" plays back the trimmed clip.

If step 2 or 3 is clearly off across several tries, tune `K` in `backend/src/scoring.ts` as described in Task 3 Step 5. Re-run `npm test -w backend` afterwards; the unit tests must stay green.

- [ ] **Step 8: Checkpoint**

`npm test` passes and the manual lab checks pass. No commit.
