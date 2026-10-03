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
