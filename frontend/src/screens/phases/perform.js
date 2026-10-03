import { send } from "../../connection.js";
import { T } from "../../strings.js";
import { h } from "../../ui/dom.js";
import { createRecorderWidget } from "../../ui/recorderWidget.js";
import { nameOf } from "../util.js";

export function createPerformView(s) {
  const performerId = s.phaseData?.performerId ?? s.room.performerId;
  if (performerId !== s.self?.id) {
    const el = h("div", {}, h("div", { class: "big-text" }, T.game.performOther(nameOf(s, performerId))));
    return { el, title: T.game.performTitle, update() {}, destroy() {} };
  }
  const widget = createRecorderWidget({
    owner: performerId,
    onSubmit: (clip) => send({ type: "player_action", action: { type: "submit_clip", audio: clip.audio, features: clip.features } }),
  });
  const prompt = s.phaseData?.prompt;
  const el = h(
    "div",
    { class: "recorder" },
    h("div", { class: "big-text" }, T.game.performYou),
    prompt ? h("div", { class: "prompt" }, T.game.promptHint(prompt)) : null,
    widget.el,
  );
  // Acceptance = the phase moves to MIMIC (this view is then destroyed). Still here after 3 s -> allow resend.
  return { el, title: T.game.performTitle, update() { widget.checkResend(); }, destroy() { widget.destroy(); } };
}
