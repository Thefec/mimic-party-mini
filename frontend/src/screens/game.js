import { isRecording } from "../audio/recorder.js";
import { sfx } from "../audio/sfx.js";
import { stopPlayback } from "../audio/player.js";
import { serverNow, state } from "../state.js";
import { T } from "../strings.js";
import { h } from "../ui/dom.js";
import { createMicPanel } from "../ui/micPanel.js";
import { createIntroView } from "./phases/intro.js";
import { createMimicView } from "./phases/mimic.js";
import { createPerformView } from "./phases/perform.js";
import { createRoundResultView } from "./phases/roundResult.js";

const VIEWS = { ROUND_INTRO: createIntroView, PERFORM: createPerformView, MIMIC: createMimicView, ROUND_RESULT: createRoundResultView };

export function createGameScreen() {
  const roundEl = h("div", { class: "round" });
  const titleEl = h("div", { class: "phase-title" });
  const timerEl = h("div", { class: "timer" });
  const micBtn = h("button", { class: "btn small", title: T.mic.title, onclick: toggleMic }, "🎙️");
  const micSlot = h("div", { class: "mic-popover" });
  const phaseSlot = h("div", { class: "panel bottom-center phase-panel" }); // intro / perform / mimic
  const sideSlot = h("div"); // round results (the view brings its own .result-panel)
  const el = h("div", { class: "screen" }, h("div", { class: "panel top-center topbar" }, roundEl, titleEl, timerEl, micBtn), micSlot, phaseSlot, sideSlot);

  let key = "";
  let view = null;
  let micPanel = null;
  let raf = 0;
  let lastSecond = null;

  function toggleMic() {
    if (micPanel) {
      micPanel.destroy();
      micPanel = null;
      micSlot.replaceChildren();
      return;
    }
    micPanel = createMicPanel();
    micSlot.append(micPanel.el);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const endsAt = state.room?.phaseEndsAt;
    micBtn.disabled = isRecording();
    if (!endsAt) {
      timerEl.textContent = "";
      return;
    }
    const left = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
    timerEl.textContent = String(left);
    timerEl.classList.toggle("urgent", left <= 3);
    if (left !== lastSecond) {
      if (left > 0 && left <= 3) sfx.tick();
      lastSecond = left;
    }
  }
  tick();

  return {
    el,
    update(s) {
      const room = s.room;
      roundEl.textContent = T.game.round(room.round, room.totalRounds);
      const nextKey = `${room.phase}:${room.round}`;
      if (nextKey !== key) {
        key = nextKey;
        view?.destroy();
        const make = VIEWS[room.phase];
        view = make ? make(s) : null;
        const side = room.phase === "ROUND_RESULT";
        phaseSlot.hidden = side || !view;
        phaseSlot.replaceChildren(...(!side && view ? [view.el] : []));
        sideSlot.replaceChildren(...(side && view ? [view.el] : []));
        titleEl.textContent = view?.title ?? "";
      }
      view?.update(s);
    },
    destroy() {
      cancelAnimationFrame(raf);
      view?.destroy();
      micPanel?.destroy();
      stopPlayback();
    },
  };
}
