# Task 12: Game screen, phase views, curves, results

**Files:**
- Replace: `frontend/src/screens/game.js`, `frontend/src/screens/results.js`
- Create: `frontend/src/screens/phases/intro.js`, `frontend/src/screens/phases/perform.js`, `frontend/src/screens/phases/mimic.js`, `frontend/src/screens/phases/roundResult.js`
- Create: `frontend/src/ui/curves.js`

**Interfaces:**
- Consumes:
  - Task 9: `state`, `serverNow`, `isHost`, `send`, `leave`, `T`
  - Task 10: `playClip`, `stopPlayback`, `isRecording`, `sfx`, `createMicPanel`, `createRecorderWidget`
  - Task 8: `COLORS`, `h`
  - Task 11: `nameOf`, `playerById`
- Produces:
  - `createGameScreen()`, `createResultsScreen()` (screen contract from Task 11)
  - Phase views: `createIntroView(s)`, `createPerformView(s)`, `createMimicView(s)`, `createRoundResultView(s)`, each returning `{ el, title, update(s), destroy() }`
  - `drawCurves(canvas, originalFeatures, imitationFeatures | null, color)`

`game.js` rebuilds the phase view whenever `phase:round` changes, and otherwise calls `view.update(s)`. The timer runs on `requestAnimationFrame` from `room.phaseEndsAt` and `serverNow()`.

- [ ] **Step 1: Curves**

`frontend/src/ui/curves.js`:
```js
// Same normalization as the server (backend/src/scoring.ts) so what you see is what is scored.
function energyCurve(f) {
  const max = Math.max(...f.energy);
  return f.energy.map((v) => (Math.min(0, Math.max(-40, v - max)) + 40) / 40);
}

function pitchCurve(f) {
  const voiced = f.pitch.filter((p) => p > 0).sort((a, b) => a - b);
  if (!voiced.length) return f.pitch.map(() => null);
  const ref = voiced[voiced.length >> 1];
  return f.pitch.map((p) => (p > 0 ? Math.max(-12, Math.min(12, 12 * Math.log2(p / ref))) : null));
}

/** Top half: loudness (rhythm). Bottom half: melody in semitones (±12). */
export function drawCurves(canvas, original, imitation, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = (canvas.width = Math.round(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.round(canvas.clientHeight * dpr));
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!original) return;
  const frames = Math.max(original.energy.length, imitation?.energy.length ?? 0, 2);
  const x = (i) => (i / (frames - 1)) * w;
  const half = h / 2;

  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = dpr;
  g.beginPath();
  g.moveTo(0, half);
  g.lineTo(w, half);
  g.stroke();

  const line = (values, top, toY, style, width) => {
    g.strokeStyle = style;
    g.lineWidth = width * dpr;
    g.lineJoin = "round";
    g.beginPath();
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      const y = top + toY(v);
      if (pen) g.lineTo(x(i), y);
      else g.moveTo(x(i), y);
      pen = true;
    });
    g.stroke();
  };
  const energyY = (v) => (1 - v) * (half - 8 * dpr) + 4 * dpr;
  const pitchY = (v) => ((12 - v) / 24) * (half - 8 * dpr) + 4 * dpr;

  line(energyCurve(original), 0, energyY, "rgba(255,255,255,0.9)", 4);
  line(pitchCurve(original), half, pitchY, "rgba(255,255,255,0.9)", 4);
  if (imitation) {
    line(energyCurve(imitation), 0, energyY, color, 3);
    line(pitchCurve(imitation), half, pitchY, color, 3);
  }
}
```

- [ ] **Step 2: Phase views**

`frontend/src/screens/phases/intro.js`:
```js
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
```

`frontend/src/screens/phases/perform.js`:
```js
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
```

`frontend/src/screens/phases/mimic.js`:
```js
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
```

`frontend/src/screens/phases/roundResult.js`:
```js
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
      h(
        "div",
        { class: "result-row original" },
        h("span", {}, `${T.game.original} — ${nameOf(s, result.performerId)}`),
        h("span", { class: "muted small" }, T.game.performerPoints(result.performerPoints)),
        playBtn(result.original, result.performerId),
      ),
      rows.map((r) => {
        const row = h(
          "div",
          { class: "result-row", "data-id": r.playerId, onclick: () => r.submitted && select(r) },
          h("span", { class: "swatch", style: `background:${colorOf(r.playerId)}` }),
          h("span", {}, nameOf(s, r.playerId)),
          r.submitted ? h("span", { class: "score" }, String(r.score)) : h("span", { class: "muted small" }, T.game.notSubmitted),
          r.submitted ? playBtn(r.clip, r.playerId) : h("span"),
          r.submitted && r.breakdown ? bars(r.breakdown) : null,
        );
        return row;
      }),
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
```

- [ ] **Step 3: Game screen**

`frontend/src/screens/game.js`:
```js
import { isRecording } from "../audio/recorder.js";
import { sfx } from "../audio/sfx.js";
import { stopPlayback } from "../audio/player.js";
import { serverNow, state } from "../state.js";
import { T } from "../strings.js";
import { h } from "../ui/dom.js";
import { createMicPanel } from "../ui/micPanel.js";
import { createIntroView } from "./phases/intro.js";
import { createMimicView } from "./phases/mimic.js";
import { createPerformView } from "./phases/perform.js";
import { createRoundResultView } from "./phases/roundResult.js";

const VIEWS = { ROUND_INTRO: createIntroView, PERFORM: createPerformView, MIMIC: createMimicView, ROUND_RESULT: createRoundResultView };

export function createGameScreen() {
  const roundEl = h("div", { class: "round" });
  const titleEl = h("div", { class: "phase-title" });
  const timerEl = h("div", { class: "timer" });
  const micBtn = h("button", { class: "btn small", title: T.mic.title, onclick: toggleMic }, "🎙️");
  const micSlot = h("div", { class: "mic-popover" });
  const phaseSlot = h("div", { class: "panel bottom-center phase-panel" }); // intro / perform / mimic
  const sideSlot = h("div"); // round results (the view brings its own .result-panel)
  const el = h("div", { class: "screen" }, h("div", { class: "panel top-center topbar" }, roundEl, titleEl, timerEl, micBtn), micSlot, phaseSlot, sideSlot);

  let key = "";
  let view = null;
  let micPanel = null;
  let raf = 0;
  let lastSecond = null;

  function toggleMic() {
    if (micPanel) {
      micPanel.destroy();
      micPanel = null;
      micSlot.replaceChildren();
      return;
    }
    micPanel = createMicPanel();
    micSlot.append(micPanel.el);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const endsAt = state.room?.phaseEndsAt;
    if (!endsAt) {
      timerEl.textContent = "";
      return;
    }
    const left = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
    timerEl.textContent = String(left);
    timerEl.classList.toggle("urgent", left <= 3);
    if (left !== lastSecond) {
      if (left > 0 && left <= 3) sfx.tick();
      lastSecond = left;
    }
    micBtn.disabled = isRecording();
  }
  tick();

  return {
    el,
    update(s) {
      const room = s.room;
      roundEl.textContent = T.game.round(room.round, room.totalRounds);
      const nextKey = `${room.phase}:${room.round}`;
      if (nextKey !== key) {
        key = nextKey;
        view?.destroy();
        const make = VIEWS[room.phase];
        view = make ? make(s) : null;
        const side = room.phase === "ROUND_RESULT";
        phaseSlot.hidden = side || !view;
        phaseSlot.replaceChildren(...(!side && view ? [view.el] : []));
        sideSlot.replaceChildren(...(side && view ? [view.el] : []));
        titleEl.textContent = view?.title ?? "";
      }
      view?.update(s);
    },
    destroy() {
      cancelAnimationFrame(raf);
      view?.destroy();
      micPanel?.destroy();
      stopPlayback();
    },
  };
}
```

- [ ] **Step 4: Results screen**

`frontend/src/screens/results.js`:
```js
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
      { class: "panel bottom-center results-panel" },
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
```

- [ ] **Step 5: Build and play a full game**

Run: `npm test` → PASS. `npm run dev`.

Use two Chrome tabs (A = host, B), plus a third tab or a second browser (Edge) for C. Headphones are recommended, otherwise playback leaks into recordings.
1. A starts. All tabs: the topbar shows "Tur 1/3", "Sıradaki", and a countdown. The camera zooms to A with a prompt bubble, and a whoosh plays.
2. PERFORM: A sees the recorder with the prompt hint. Space starts recording, and A's character's mouth moves with A's voice on A's screen. Space stops, "Dinle" plays it back, Enter sends. B and C see "A ses kaydediyor…" and a "🎙️ kaydediyor…" bubble. The last 3 seconds tick and the timer turns red.
3. MIMIC: B and C hear the original automatically, and A's character lip-syncs to it on every screen. B records and sends. A ✔ appears over B on all screens, and the counter shows "1/2 taklit geldi". When C sends, the phase ends early.
4. ROUND_RESULT: the side panel shows the original row plus sorted mimic rows with score and bars. The curves canvas draws a white original and a colored imitation. Clicking a row switches the curve, and ▶ plays that clip while that player's character lip-syncs. The best mimic's character jumps, and +scores pop over heads. A ding plays.
5. Skipped round: when B is the performer, B doesn't record → after 12 s, "Tur atlandı — ses gelmedi." for 4 s.
6. Mid-MIMIC reload: C reloads during MIMIC → C rejoins, hears the original, can still submit.
7. Game end: podium with medals. The winner spins, a fanfare plays, and the host sees "Tekrar oyna". Press it → everyone returns to the lobby with scores reset.
8. Host leaves on results: in a fresh game, A clicks "Odadan çık" on the results screen. B becomes host (★) and can press "Tekrar oyna".
9. 🎙️ in the topbar opens the mic panel. It is disabled while recording.

Fix anything that does not match, then re-run the relevant check.

- [ ] **Step 6: Checkpoint**

`npm test` passes and the full manual game works. No commit.
