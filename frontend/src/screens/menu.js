import { unlockAudio } from "../audio/audioContext.js";
import { createRoom, joinRoom } from "../connection.js";
import { loadPref, PREF_AVATAR, PREF_NAME, savePref } from "../prefs.js";
import { isAvatar, randomAvatar } from "../scene/avatarOptions.js";
import { showError } from "../state.js";
import { T } from "../strings.js";
import { createAvatarEditor } from "../ui/avatarEditor.js";
import { h } from "../ui/dom.js";

export function createMenuScreen() {
  let avatar = loadPref(PREF_AVATAR, null);
  if (!isAvatar(avatar)) {
    avatar = randomAvatar();
    savePref(PREF_AVATAR, avatar);
  }
  const roomFromLink = (new URLSearchParams(location.search).get("room") ?? "").toUpperCase().slice(0, 5);

  const nameInput = h("input", { class: "input", maxlength: 16, placeholder: T.menu.nicknamePlaceholder, value: loadPref(PREF_NAME, "") });
  const codeInput = h("input", { class: "input code", maxlength: 5, placeholder: "A7K2P", value: roomFromLink });
  const createBtn = h("button", { class: "btn primary big", onclick: onCreate }, T.menu.create);
  const joinBtn = h("button", { class: "btn big", onclick: onJoin }, T.menu.join);
  const hint = h("div", { class: "menu-hint" });
  const editor = createAvatarEditor({ avatar, onChange: (a) => { avatar = a; savePref(PREF_AVATAR, a); } });

  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") (codeInput.value.trim() ? onJoin : onCreate)(); });
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") onJoin(); });

  const el = h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "panel center menu-panel" },
      h("h1", { class: "logo" }, T.title),
      editor.el,
      h("label", { class: "field" }, h("span", { class: "label" }, T.menu.nickname), nameInput),
      createBtn,
      h("div", { class: "divider" }, T.menu.or),
      h("div", { class: "join-row" }, codeInput, joinBtn),
      hint,
    ),
  );
  requestAnimationFrame(() => nameInput.focus());

  let busy = false;
  function setBusy(b) {
    busy = b;
    createBtn.disabled = b;
    joinBtn.disabled = b;
  }

  function readName() {
    const name = nameInput.value.trim();
    if (!name) {
      hint.textContent = T.menu.needName;
      nameInput.focus();
      return null;
    }
    savePref(PREF_NAME, name);
    hint.textContent = "";
    return name;
  }

  async function onCreate() {
    if (busy) return;
    const name = readName();
    if (!name) return;
    unlockAudio();
    setBusy(true);
    try {
      joinRoom(await createRoom(), name, avatar);
    } catch {
      setBusy(false);
      showError("CONNECTION_ERROR");
    }
  }

  function onJoin() {
    if (busy) return;
    const name = readName();
    if (!name) return;
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      hint.textContent = T.menu.needCode;
      codeInput.focus();
      return;
    }
    unlockAudio();
    setBusy(true);
    joinRoom(code, name, avatar);
  }

  return {
    el,
    update(s) {
      // Connecting keeps the buttons disabled; a failed join ("closed") re-enables them.
      if (s.connection === "closed" || s.connection === "idle") setBusy(false);
      if (s.connection === "connecting") hint.textContent = T.connection.connecting;
      else if (hint.textContent === T.connection.connecting) hint.textContent = "";
    },
    destroy() {
      editor.destroy();
    },
  };
}
