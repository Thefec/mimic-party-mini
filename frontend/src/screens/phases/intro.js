import { sfx } from "../../audio/sfx.js";
import { T } from "../../strings.js";
import { h } from "../../ui/dom.js";
import { nameOf } from "../util.js";

export function createIntroView(s) {
  sfx.whoosh();
  const prompt = s.phaseData?.prompt;
  const el = h(
    "div",
    { class: "intro" },
    h("div", { class: "big-text" }, T.game.intro(nameOf(s, s.phaseData?.performerId ?? s.room.performerId))),
    prompt ? h("div", { class: "prompt" }, T.game.promptHint(prompt)) : null,
  );
  return { el, title: T.game.introTitle, update() {}, destroy() {} };
}
