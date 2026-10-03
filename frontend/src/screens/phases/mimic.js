import { playClip, stopPlayback } from "../../audio/player.js";
import { send } from "../../connection.js";
import { T } from "../../strings.js";
import { h } from "../../ui/dom.js";
import { createRecorderWidget } from "../../ui/recorderWidget.js";

export function createMimicView(s) {
  const performerId = s.phaseData?.performerId ?? s.room.performerId;
  const clip = s.phaseData?.clip ?? null;
  const me = s.self?.id;
  const iAmPerformer = performerId === me;

  const listen = h("button", { class: "btn big", onclick: () => playClip(clip, { owner: performerId }) }, "▶ " + T.game.listen);
  listen.disabled = !clip;
  const progress = h("div", { class: "muted" });

  let widget = null;
  let autoplay = 0;
  if (!iAmPerformer) {
    widget = createRecorderWidget({
      owner: me,
      beforeRecord: () => stopPlayback(),
      onSubmit: (c) => send({ type: "player_action", action: { type: "submit_clip", audio: c.audio, features: c.features } }),
    });
    if (clip) autoplay = setTimeout(() => playClip(clip, { owner: performerId }), 400);
  }

  const el = h(
    "div",
    { class: "recorder" },
    h("div", { class: "big-text" }, iAmPerformer ? T.game.mimicYouPerformer : T.game.mimicYou),
    listen,
    widget?.el ?? null,
    progress,
  );

  return {
    el,
    title: T.game.mimicTitle,
    update(st) {
      const mimics = st.room.players.filter((p) => p.id !== performerId && p.connected).length;
      progress.textContent = T.game.submittedCount(st.room.submitted.length, mimics);
      if (!widget) return;
      if (st.room.submitted.includes(me)) widget.markAccepted();
      else widget.checkResend();
    },
    destroy() {
      clearTimeout(autoplay);
      widget?.destroy();
    },
  };
}
