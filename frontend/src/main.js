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
