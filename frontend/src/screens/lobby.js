import { leave, send } from "../connection.js";
import { PREF_AVATAR, savePref } from "../prefs.js";
import { isHost, selfPlayer } from "../state.js";
import { T } from "../strings.js";
import { createAvatarEditor } from "../ui/avatarEditor.js";
import { h } from "../ui/dom.js";
import { createMicPanel } from "../ui/micPanel.js";
import { copyText } from "./util.js";

export function createLobbyScreen() {
  const codeEl = h("div", { class: "room-code" });
  const countEl = h("div", { class: "muted" });
  const linkAvailable = location.protocol === "http:" || location.protocol === "https:";
  let roomId = "";

  const copyBtn = (label, getText) => {
    const btn = h("button", { class: "btn small" }, label);
    btn.addEventListener("click", async () => {
      if (await copyText(getText())) {
        btn.textContent = T.lobby.copied;
        setTimeout(() => { btn.textContent = label; }, 1200);
      }
    });
    return btn;
  };

  const cycleButtons = [1, 2, 3].map((c) =>
    h("button", { class: "btn seg", "data-c": c, onclick: () => send({ type: "update_settings", cycles: c }) }, T.lobby.cyclesOption(c)),
  );
  const startBtn = h("button", { class: "btn primary big", onclick: () => send({ type: "start_game" }) }, T.lobby.start);
  const hostControls = h("div", { class: "field" }, h("div", { class: "label" }, T.lobby.cycles), h("div", { class: "segmented" }, cycleButtons), startBtn);
  const waitEl = h("div", { class: "muted" });

  const micPanel = createMicPanel();
  let editor = null;
  const editorSlot = h("div");
  const editBtn = h("button", { class: "btn", onclick: toggleEditor }, T.lobby.editAvatar);

  function toggleEditor() {
    if (editor) {
      editor.destroy();
      editor = null;
      editorSlot.replaceChildren();
      editBtn.textContent = T.lobby.editAvatar;
      return;
    }
    const me = selfPlayer();
    if (!me) return;
    editor = createAvatarEditor({
      avatar: me.avatar,
      onChange: (avatar) => {
        savePref(PREF_AVATAR, avatar);
        send({ type: "update_avatar", avatar });
      },
    });
    editorSlot.append(editor.el);
    editBtn.textContent = T.lobby.done;
  }

  const el = h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "panel top-left" },
      h("div", { class: "label" }, T.lobby.roomCode),
      codeEl,
      h("div", { class: "row" }, copyBtn(T.lobby.copyCode, () => roomId), linkAvailable ? copyBtn(T.lobby.copyLink, () => `${location.origin}${location.pathname}?room=${roomId}`) : null),
      countEl,
    ),
    h("div", { class: "panel bottom-center lobby-bottom" }, hostControls, waitEl),
    h("div", { class: "panel right" }, micPanel.el, editBtn, editorSlot, h("button", { class: "btn ghost", onclick: leave }, T.lobby.leave)),
  );

  return {
    el,
    update(s) {
      const room = s.room;
      roomId = room.id;
      codeEl.textContent = room.id;
      countEl.textContent = T.lobby.players(room.players.length);
      const host = isHost();
      const connected = room.players.filter((p) => p.connected).length;
      hostControls.hidden = !host;
      for (const b of cycleButtons) b.classList.toggle("active", Number(b.dataset.c) === room.settings.cycles);
      startBtn.disabled = connected < 2;
      const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? "Host";
      waitEl.textContent = host ? (connected < 2 ? T.lobby.needPlayers : "") : T.lobby.waitingHost(hostName);
    },
    destroy() {
      micPanel.destroy();
      editor?.destroy();
    },
  };
}
