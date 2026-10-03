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
