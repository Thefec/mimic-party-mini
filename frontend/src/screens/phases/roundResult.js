import { playClip } from "../../audio/player.js";
import { sfx } from "../../audio/sfx.js";
import { COLORS } from "../../scene/avatarOptions.js";
import { T } from "../../strings.js";
import { drawCurves } from "../../ui/curves.js";
import { h } from "../../ui/dom.js";
import { nameOf, playerById } from "../util.js";

export function createRoundResultView(s) {
  const panel = h("div", { class: "panel result-panel" });
  const el = h("div", {}, panel); // positioned on the right via .result-panel
  let built = false;

  const playBtn = (clip, owner) =>
    h("button", { class: "btn small", onclick: (e) => { e.stopPropagation(); playClip(clip, { owner }); } }, "▶");

  const bars = (b) =>
    h(
      "div",
      { class: "bars" },
      [[T.game.rhythm, b.rhythm], [T.game.pitch, b.pitch], [T.game.tone, b.tone]].map(([label, v]) =>
        h("div", {}, `${label} ${v ?? "—"}`, h("div", { class: "bar" }, h("div", { style: `width:${v ?? 0}%` }))),
      ),
    );

  function build(result) {
    built = true;
    sfx.ding();
    if (result.skipped) {
      panel.append(h("h2", {}, T.game.skipped));
      return;
    }
    const canvas = h("canvas", { class: "curves" });
    const rows = [...result.results].sort((a, b) => b.score - a.score);
    const colorOf = (id) => COLORS[playerById(s, id)?.avatar.color ?? 0];

    const select = (r) => {
      for (const row of panel.querySelectorAll(".result-row[data-id]")) row.classList.toggle("selected", row.dataset.id === r.playerId);
      drawCurves(canvas, result.original.features, r.clip?.features ?? null, colorOf(r.playerId));
    };

    panel.append(
      h("h2", {}, T.game.resultHeading(nameOf(s, result.performerId))),
      h("div", { class: "score-explain muted small" }, T.game.scoreExplain),
      h(
        "div",
        { class: "result-row original" },
        h("span", {}, `${T.game.original} — ${nameOf(s, result.performerId)}`),
        h("span", { class: "muted small" }, T.game.performerPoints(result.performerPoints)),
        playBtn(result.original, result.performerId),
      ),
      ...rows.map((r) =>
        h(
          "div",
          { class: "result-row", "data-id": r.playerId, onclick: () => r.submitted && select(r) },
          h("span", { class: "swatch", style: `background:${colorOf(r.playerId)}` }),
          h("span", {}, nameOf(s, r.playerId), r.submitted ? h("span", { class: "rating" }, T.game.rating(r.score)) : null),
          r.submitted ? h("span", { class: "score" }, String(r.score)) : h("span", { class: "muted small" }, T.game.notSubmitted),
          r.submitted ? playBtn(r.clip, r.playerId) : h("span"),
          r.submitted && r.breakdown ? bars(r.breakdown) : null,
        ),
      ),
      canvas,
      h("div", { class: "legend" }, "⬜ orijinal · renkli: seçili taklit — üst: ritim, alt: melodi"),
    );
    const best = rows.find((r) => r.submitted);
    requestAnimationFrame(() => (best ? select(best) : drawCurves(canvas, result.original.features, null, "#fff")));
  }

  function update(st) {
    if (!built && st.roundResult && st.roundResult.round === st.room.round) build(st.roundResult);
  }
  update(s);
  return { el, title: T.game.resultTitle, update, destroy() {} };
}
