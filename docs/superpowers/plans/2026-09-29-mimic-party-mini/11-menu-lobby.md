# Task 11: Styles, avatar editor, app shell, menu, lobby

**Files:**
- Replace: `frontend/src/styles.css`, `frontend/src/main.js`
- Create: `frontend/src/ui/avatarEditor.js`, `frontend/src/screens/util.js`, `frontend/src/screens/menu.js`, `frontend/src/screens/lobby.js`
- Create (stubs, replaced in Task 12): `frontend/src/screens/game.js`, `frontend/src/screens/results.js`

**Interfaces:**
- Consumes:
  - Task 8: `Stage`, `Labels`, `createDirector`, `Character`, `AVATAR_OPTIONS`, `COLORS`, `randomAvatar`, `isAvatar`, `h`
  - Task 9: `T`, `state`, `subscribe`, `update`, `isHost`, `selfPlayer`, `showError`, `createRoom`, `joinRoom`, `tryResume`, `send`, `leave`, `loadPref`, `savePref`, `PREF_NAME`, `PREF_AVATAR`
  - Task 10: `unlockAudio`, `playbackLevel`, `isRecording`, `micLevel`, `createMicPanel`
- Produces:
  - Screen contract: every `createXScreen()` returns `{ el, update(state), destroy() }`. `main.js` swaps screens by route (`menu` | `lobby` | `game` | `results`) and calls `update` on every state change.
  - `screens/util.js`: `playerById(s, id)`, `nameOf(s, id)`, `copyText(text) → Promise<boolean>`
  - `avatarEditor.js`: `createAvatarEditor({ avatar, onChange }) → { el, destroy() }`
  - `styles.css`: every class used by Tasks 11–12. The class names are listed in the CSS below; Task 12 reuses them.

- [ ] **Step 1: Styles**

`frontend/src/styles.css`:
```css
:root {
  --bg: #2b1f4a;
  --panel: rgba(24, 16, 44, 0.86);
  --panel-border: rgba(255, 255, 255, 0.14);
  --text: #fff8ec;
  --muted: #cbbfe6;
  --accent: #ffd23f;
  --accent-ink: #2b1f4a;
  --pink: #ff66c4;
  --ok: #7bd389;
  --danger: #ff5d5d;
  --radius: 18px;
  font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  color: var(--text);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); }
[hidden] { display: none !important; }

#stage { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
#labels, #ui { position: fixed; inset: 0; pointer-events: none; }
.screen { position: absolute; inset: 0; }

/* ---------- panels ---------- */
.panel {
  pointer-events: auto; position: absolute; background: var(--panel); border: 3px solid var(--panel-border);
  border-radius: var(--radius); padding: 18px 20px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35); backdrop-filter: blur(6px);
}
.top-left { top: 20px; left: 20px; }
.top-right { top: 20px; right: 20px; }
.top-center { top: 16px; left: 50%; transform: translateX(-50%); }
.bottom-center { bottom: 20px; left: 50%; transform: translateX(-50%); }
.right { top: 20px; right: 20px; width: 300px; display: flex; flex-direction: column; gap: 12px; max-height: calc(100vh - 40px); overflow: auto; }
.center { top: 50%; left: 50%; transform: translate(-50%, -50%); }

.label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.big-text { font-size: 30px; font-weight: 900; text-align: center; }
.hint { font-size: 12px; color: var(--muted); text-align: center; }

/* ---------- controls ---------- */
.btn {
  font: inherit; font-weight: 800; font-size: 16px; color: var(--text); background: rgba(255, 255, 255, 0.12);
  border: 2px solid rgba(255, 255, 255, 0.2); border-radius: 14px; padding: 10px 16px; cursor: pointer;
  transition: transform 0.08s, background 0.15s;
}
.btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); transform: translateY(-1px); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.btn.primary:hover:not(:disabled) { background: #ffe066; }
.btn.ghost { background: transparent; }
.btn.big { font-size: 20px; padding: 14px 22px; }
.btn.small { font-size: 13px; padding: 6px 10px; border-radius: 10px; }
.btn.record { background: var(--danger); border-color: transparent; min-width: 220px; }
.btn.record.recording { animation: pulse 0.9s infinite; }
.input {
  font: inherit; font-size: 18px; color: var(--text); background: rgba(0, 0, 0, 0.3); border: 2px solid var(--panel-border);
  border-radius: 12px; padding: 10px 12px; outline: none; width: 100%;
}
.input:focus { border-color: var(--accent); }
.input.code { text-transform: uppercase; letter-spacing: 0.3em; font-weight: 900; text-align: center; }
select.input { font-size: 14px; }
.segmented { display: flex; gap: 6px; }
.seg { flex: 1; }
.seg.active { background: var(--accent); color: var(--accent-ink); }

.meter { height: 10px; background: rgba(0, 0, 0, 0.35); border-radius: 6px; overflow: hidden; }
.meter-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--ok), var(--accent), var(--danger)); transition: width 0.05s linear; }

/* ---------- menu ---------- */
.menu-panel { width: 440px; display: flex; flex-direction: column; gap: 14px; }
.logo { margin: 0; text-align: center; font-size: 40px; font-weight: 900; color: var(--accent); text-shadow: 0 4px 0 #b83280; letter-spacing: 0.02em; }
.field { display: flex; flex-direction: column; gap: 6px; }
.divider { text-align: center; color: var(--muted); font-size: 13px; }
.join-row { display: flex; gap: 8px; }
.join-row .input { flex: 1; }
.menu-hint { min-height: 18px; color: var(--pink); text-align: center; font-size: 14px; }

/* ---------- avatar editor ---------- */
.avatar-editor { display: flex; gap: 12px; align-items: center; }
.avatar-preview { width: 150px; height: 150px; border-radius: 16px; background: radial-gradient(circle at 50% 40%, #4a3a7a, #241a40); flex-shrink: 0; }
.opt-rows { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.opt-row { display: grid; grid-template-columns: 70px 30px 1fr 30px; align-items: center; gap: 4px; font-size: 13px; }
.opt-label { color: var(--muted); }
.opt-value { text-align: center; font-weight: 800; }
.opt-value.swatch { height: 20px; border-radius: 6px; }

/* ---------- lobby ---------- */
.room-code { font-size: 44px; font-weight: 900; letter-spacing: 0.25em; color: var(--accent); }
.lobby-bottom { width: 420px; display: flex; flex-direction: column; gap: 10px; text-align: center; }
.mic-panel { display: flex; flex-direction: column; gap: 8px; }

/* ---------- labels over characters ---------- */
.label-name, .label-badge, .label-bubble { pointer-events: none; }
#labels .label { position: absolute; left: 0; top: 0; text-align: center; white-space: nowrap; text-transform: none; letter-spacing: 0; }
.label-name { font-size: 16px; font-weight: 800; color: #fff; text-shadow: 0 2px 4px #000, 0 0 2px #000; }
#labels .label.self .label-name { color: var(--accent); }
.label-badge { font-size: 26px; font-weight: 900; color: var(--accent); text-shadow: 0 3px 0 #000; }
.label-badge.pop { animation: pop 0.45s ease-out; }
.label-bubble { background: #fff; color: #2b1f4a; font-weight: 800; border-radius: 14px; padding: 6px 12px; margin-bottom: 6px; box-shadow: 0 4px 0 rgba(0, 0, 0, 0.25); }

/* ---------- game ---------- */
.topbar { display: flex; align-items: center; gap: 18px; padding: 10px 18px; }
.round { font-weight: 800; color: var(--muted); }
.phase-title { font-weight: 900; font-size: 20px; }
.timer { font-size: 34px; font-weight: 900; min-width: 48px; text-align: center; color: var(--accent); }
.timer.urgent { color: var(--danger); animation: pulse 0.5s infinite; }
.mic-popover { position: absolute; top: 90px; left: 50%; transform: translateX(-50%); }
.mic-popover .mic-panel { pointer-events: auto; background: var(--panel); border: 3px solid var(--panel-border); border-radius: var(--radius); padding: 14px; width: 320px; }
.phase-panel { width: 560px; display: flex; flex-direction: column; gap: 12px; align-items: center; text-align: center; }
.prompt { font-size: 18px; color: var(--pink); font-weight: 800; }
.recorder { display: flex; flex-direction: column; gap: 10px; align-items: center; width: 100%; }
.recorder .meter { width: 100%; }

.result-panel { top: 90px; right: 20px; width: 440px; max-height: calc(100vh - 110px); overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.result-panel h2 { margin: 0 0 4px; font-size: 20px; }
.result-row { display: grid; grid-template-columns: 14px 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 12px; background: rgba(255, 255, 255, 0.06); cursor: pointer; }
.result-row.selected { outline: 3px solid var(--accent); }
.result-row.original { grid-template-columns: 1fr auto auto; cursor: default; }
.result-row .swatch { width: 14px; height: 14px; border-radius: 4px; }
.result-row .score { font-size: 26px; font-weight: 900; color: var(--accent); }
.bars { grid-column: 2 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 11px; color: var(--muted); }
.bar { height: 6px; background: rgba(0, 0, 0, 0.35); border-radius: 4px; overflow: hidden; margin-top: 2px; }
.bar > div { height: 100%; background: var(--ok); }
.curves { width: 100%; height: 160px; background: rgba(0, 0, 0, 0.25); border-radius: 12px; }
.legend { font-size: 12px; color: var(--muted); }

/* ---------- results ---------- */
.results-panel { width: 460px; display: flex; flex-direction: column; gap: 12px; text-align: center; }
.results-panel.center { top: auto; bottom: 20px; transform: translateX(-50%); }
.standings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.standings li { display: grid; grid-template-columns: 44px 1fr auto; align-items: center; padding: 8px 12px; background: rgba(255, 255, 255, 0.06); border-radius: 12px; font-size: 18px; font-weight: 800; }
.standings .rank { font-size: 24px; }
.standings .pts { color: var(--accent); }

/* ---------- toast / banner / fatal ---------- */
#toast, #banner { position: fixed; left: 50%; transform: translateX(-50%); z-index: 10; font-weight: 800; border-radius: 14px; padding: 12px 18px; }
#toast { bottom: 24px; background: var(--danger); color: #fff; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4); }
#banner { top: 12px; background: var(--accent); color: var(--accent-ink); }
.fatal { top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 520px; font-size: 18px; text-align: center; }

@keyframes pulse { 50% { transform: scale(1.06); } }
@keyframes pop { 0% { transform: scale(0.3); opacity: 0; } 70% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
```

- [ ] **Step 2: Avatar editor**

`frontend/src/ui/avatarEditor.js`:
```js
import * as THREE from "three";
import { Character } from "../scene/character.js";
import { AVATAR_OPTIONS, COLORS, randomAvatar } from "../scene/avatarOptions.js";
import { T } from "../strings.js";
import { h } from "./dom.js";

/** Rotating 3D preview + one ◀ ▶ picker per option + randomize. */
export function createAvatarEditor({ avatar, onChange }) {
  let current = { ...avatar };

  const canvas = h("canvas", { class: "avatar-preview" });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(150, 150, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffe9c7", "#3b2a66", 1.3));
  const key = new THREE.DirectionalLight("#ffffff", 1.4);
  key.position.set(2, 4, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 1.6, 5.2);
  camera.lookAt(0, 1.0, 0);
  const character = new Character(current);
  scene.add(character.root);

  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    character.root.rotation.y += dt * 0.8;
    character.update(dt, clock.elapsedTime);
    renderer.render(scene, camera);
  };
  loop();

  const rows = ["body", "color", "eyes", "hat"].map((k) => {
    const value = h("span", { class: "opt-value" });
    const row = h(
      "div",
      { class: "opt-row" },
      h("span", { class: "opt-label" }, T.menu[k]),
      h("button", { class: "btn small", onclick: () => step(k, -1) }, "◀"),
      value,
      h("button", { class: "btn small", onclick: () => step(k, 1) }, "▶"),
    );
    const render = () => {
      if (k === "color") {
        value.textContent = "";
        value.classList.add("swatch");
        value.style.background = COLORS[current.color];
      } else {
        value.textContent = T.avatar[k][current[k]];
      }
    };
    return { row, render };
  });

  function step(k, delta) {
    const n = AVATAR_OPTIONS[k].length;
    current = { ...current, [k]: (current[k] + delta + n) % n };
    apply();
  }

  function apply() {
    character.setAvatar(current);
    character.jump(3);
    for (const r of rows) r.render();
    onChange({ ...current });
  }

  for (const r of rows) r.render();
  const dice = h("button", { class: "btn small", onclick: () => { current = randomAvatar(); apply(); } }, "🎲 " + T.menu.randomize);
  const el = h("div", { class: "avatar-editor" }, canvas, h("div", { class: "opt-rows" }, rows.map((r) => r.row), dice));

  return {
    el,
    destroy() {
      cancelAnimationFrame(raf);
      character.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
```

- [ ] **Step 3: Screen utilities and stubs**

`frontend/src/screens/util.js`:
```js
export const playerById = (s, id) => s.room?.players.find((p) => p.id === id) ?? null;
export const nameOf = (s, id) => playerById(s, id)?.name ?? "?";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

`frontend/src/screens/game.js` (stub, replaced in Task 12):
```js
import { h } from "../ui/dom.js";

export function createGameScreen() {
  const info = h("div", { class: "panel top-center" });
  return { el: h("div", { class: "screen" }, info), update(s) { info.textContent = `${s.room.phase} — tur ${s.room.round}`; }, destroy() {} };
}
```

`frontend/src/screens/results.js` (stub, replaced in Task 12):
```js
import { h } from "../ui/dom.js";

export function createResultsScreen() {
  return { el: h("div", { class: "screen" }, h("div", { class: "panel top-center" }, "GAME_RESULT")), update() {}, destroy() {} };
}
```

- [ ] **Step 4: Menu screen**

`frontend/src/screens/menu.js`:
```js
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
```

- [ ] **Step 5: Lobby screen**

`frontend/src/screens/lobby.js`:
```js
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
```

- [ ] **Step 6: App shell**

`frontend/src/main.js`:
```js
import { playbackLevel } from "./audio/player.js";
import { isRecording, micLevel } from "./audio/recorder.js";
import { tryResume } from "./connection.js";
import { loadPref, PREF_AVATAR, PREF_NAME } from "./prefs.js";
import { isAvatar, randomAvatar } from "./scene/avatarOptions.js";
import { createDirector } from "./scene/director.js";
import { Labels } from "./scene/labels.js";
import { Stage } from "./scene/stage.js";
import { createGameScreen } from "./screens/game.js";
import { createLobbyScreen } from "./screens/lobby.js";
import { createMenuScreen } from "./screens/menu.js";
import { createResultsScreen } from "./screens/results.js";
import { state, subscribe } from "./state.js";
import { T } from "./strings.js";
import { h } from "./ui/dom.js";

const SCREENS = { menu: createMenuScreen, lobby: createLobbyScreen, game: createGameScreen, results: createResultsScreen };

/** Mouth level per character: the clip being played, or my own mic while I record. */
function levelFor(id, s) {
  const playing = playbackLevel();
  if (playing.owner === id) return playing.level;
  if (id === s.self?.id && isRecording()) return micLevel();
  return 0;
}

function route(s) {
  if (!s.room) return "menu";
  if (s.room.phase === "LOBBY") return "lobby";
  if (s.room.phase === "GAME_RESULT") return "results";
  return "game";
}

function boot() {
  const ui = document.getElementById("ui");
  let stage;
  try {
    stage = new Stage(document.getElementById("stage"));
  } catch {
    ui.append(h("div", { class: "panel fatal" }, T.errors.WEBGL));
    return;
  }
  stage.start();
  const labels = new Labels(document.getElementById("labels"), stage);
  const director = createDirector(stage, labels, { levelFor, text: { recording: T.game.recordingBubble, prompt: T.prompt } });

  const toast = document.getElementById("toast");
  const banner = document.getElementById("banner");
  let screen = null;
  let screenName = "";
  let lastErrorAt = 0;
  let toastTimer = 0;

  function render(s) {
    const name = route(s);
    if (name !== screenName) {
      screen?.destroy();
      screen = SCREENS[name]();
      ui.replaceChildren(screen.el);
      screenName = name;
    }
    screen.update(s);
    director.sync(s);

    banner.hidden = s.connection !== "reconnecting";
    banner.textContent = T.connection.reconnecting;

    if (s.local.error && s.local.errorAt !== lastErrorAt) {
      lastErrorAt = s.local.errorAt;
      toast.textContent = T.errors[s.local.error] ?? T.errors.INVALID_MESSAGE;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
    }
  }

  subscribe(render);
  render(state);

  const savedAvatar = loadPref(PREF_AVATAR, null);
  tryResume(loadPref(PREF_NAME, "Oyuncu"), isAvatar(savedAvatar) ? savedAvatar : randomAvatar());
}

boot();
```

- [ ] **Step 7: Build, run, and verify manually**

Run: `npm test` → PASS. Then `npm run dev` (builds and starts wrangler on `http://localhost:8787`).

In Chrome, open `http://localhost:8787` in **two tabs** (each tab is its own player because the session lives in sessionStorage):
1. Tab 1: the menu shows the logo, a rotating avatar preview with working ◀ ▶ pickers and 🎲, and a name field. Enter "Batu" → "Oda kur". The lobby appears with a 5-character code, and the character drops onto the stage with "★ Batu" above it.
2. "Linki kopyala" → paste the link into tab 2 → the code is prefilled. Enter "Ayşe" → "Katıl". Both tabs show both characters, and Ayşe's tab shows "Batu oyunu başlatacak…".
3. Tab 2: "Karakterini düzenle" → change the hat. Tab 1 sees Ayşe's character hop with the new hat.
4. Tab 1: switch the cycle count to 2×. The active button updates in tab 1.
5. Mic panel: "Mikrofonu test et" → the dropdown and meter work (same as the audio lab).
6. Reload tab 2 → it auto-rejoins as Ayşe, with no duplicate character.
7. Tab 2: "Odadan çık" → back to the menu, and Ayşe's character disappears in tab 1.
8. Join with a wrong code ("ZZZZZ") → toast "Böyle bir oda yok…", and the menu buttons are enabled again.
9. A name like `<b>x</b>` shows literally as `<b>x</b>` above the character.
10. Tab 1 with 2 players: "Oyunu başlat" → both tabs switch to the stub game screen showing `ROUND_INTRO — tur 1` and then `PERFORM`. The spotlight and camera move to the performer.

Stop `wrangler dev` when done.

- [ ] **Step 8: Checkpoint**

`npm test` passes and the manual checks pass. No commit.
