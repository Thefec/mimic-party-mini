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
