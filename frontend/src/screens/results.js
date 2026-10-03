import { sfx } from "../audio/sfx.js";
import { leave, send } from "../connection.js";
import { isHost } from "../state.js";
import { T } from "../strings.js";
import { h } from "../ui/dom.js";

const medal = (rank) => ["🥇", "🥈", "🥉"][rank - 1] ?? `${rank}.`;

export function createResultsScreen() {
  const winner = h("div", { class: "big-text" });
  const list = h("ol", { class: "standings" });
  const again = h("button", { class: "btn primary big", onclick: () => send({ type: "return_to_lobby" }) }, T.results.playAgain);
  const hint = h("div", { class: "muted" });
  const el = h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "panel top-right results-panel" },
      h("h2", {}, T.results.title),
      winner,
      list,
      again,
      hint,
      h("button", { class: "btn ghost", onclick: leave }, T.results.leave),
    ),
  );
  let celebrated = false;

  return {
    el,
    update(s) {
      const standings = s.standings ?? [];
      list.replaceChildren(
        ...standings.map((x) =>
          h("li", {}, h("span", { class: "rank" }, medal(x.rank)), h("span", {}, x.name), h("span", { class: "pts" }, T.results.points(x.score))),
        ),
      );
      const top = standings.filter((x) => x.rank === 1);
      winner.textContent = top.length > 1 ? T.results.tie : top.length ? T.results.winner(top[0].name) : "";
      again.hidden = !isHost();
      hint.textContent = isHost() ? "" : T.results.waitingHost;
      if (!celebrated && standings.length) {
        celebrated = true;
        sfx.fanfare();
      }
    },
    destroy() {},
  };
}
