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
