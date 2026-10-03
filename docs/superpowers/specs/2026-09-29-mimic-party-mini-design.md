# Mimic Party Mini — Implementation Spec

Date: 2026-09-29
Source: `Mimic Party Mini — Project Design.md` (the original brief). This spec refines the brief into concrete decisions. Where it deviates from the brief, the deviation is listed in §13.

---

## 1. Goal

A browser party game for 2–6 friends. Each round one player (the **performer**) records a short sound or vocal impression; everyone else records their best imitation of it. The server scores each imitation by how closely it overlaps the original (rhythm, pitch contour, timbre) and shows the curves on top of each other.

All players stand as customizable low-poly 3D characters on a shared stage, each behind a microphone stand (§5.6).

**Target platform: desktop browsers only** (current Chrome, Edge, Firefox; Safari best-effort). Phones and tablets are out of scope. The group expects to play a few times, so the design favors simplicity over production-grade hardening.

Constraints carried over from the brief: no accounts, no database, no persistent history, server-authoritative state, a single self-contained HTML client, Cloudflare Worker + Durable Object backend, deployable on the **Cloudflare Workers Free plan**.

Success = the Definition of Done in the brief (§33), with the mimic mini-game as the first and only mini-game.

---

## 2. The Mimic Mini-Game

### 2.1 Round flow

| Phase | Duration | What happens |
|---|---|---|
| `ROUND_INTRO` | 3 s | Shows who performs this round and a random fun prompt (e.g. "cat", "siren", "robot", "evil laugh"). The prompt is a suggestion only. |
| `PERFORM` | 12 s | Performer records up to 3 s. They may re-record locally, then submit. If the deadline passes with no submission, the round is skipped: `ROUND_RESULT` is shown for 4 s with `skipped: true`, no points. |
| `MIMIC` | 20 s | Non-performers receive the original clip, can replay it freely, and record up to 3 s imitations (re-record locally allowed, one submission). The phase ends early once every connected mimic has submitted. |
| `ROUND_RESULT` | 12 s | Shows each mimic's score and breakdown, the overlaid curves (original vs each imitation), and lets anyone replay any clip. |

Game length: every player performs once per **cycle**. The host picks 1, 2 or 3 cycles in the lobby (default 1). `totalRounds = playersAtStart × cycles`. Performer order is the join order, rotated; disconnected players' performer turns are skipped.

### 2.2 Scoring

- Each mimic gets **0–100** for the round.
- The performer gets `round(average of submitted mimic scores × 0.5)` — rewarding sounds that are imitable. If nobody submitted, the performer gets 0.
- Mimics who do not submit (or are disconnected) get 0.
- Scores accumulate across rounds. Ties share a rank.

### 2.3 Similarity algorithm (server, `scoring.ts`)

Input per clip: feature arrays at **25 frames/s** (40 ms hop), at most 80 frames (≈3.2 s), produced by the client (§5.3):

- `energy[i]` — RMS loudness in dBFS
- `pitch[i]` — fundamental frequency in Hz, `0` when unvoiced
- `centroid[i]` — spectral centroid in Hz

Preprocessing (per clip):

1. **Energy** → subtract the clip's max, clamp to [-40, 0] dB, scale to [0, 1].
2. **Pitch** → for voiced frames convert to semitones relative to the clip's median voiced pitch (key-invariant: a low voice can imitate a high one). Unvoiced frames stay unvoiced.
3. **Centroid** → `log2(centroid)` minus the clip's mean (brightness contour, loudness-invariant).

Silence rule: if the imitation has fewer than 5 frames (0.2 s) above -35 dBFS, its score is **0**.

Alignment: **DTW** with a Sakoe–Chiba band of 30% of the longer length, over the frame distance

```
d = wE·|ΔE| + wP·pitchDist + wT·min(|ΔT|, 1)
pitchDist = both voiced   → min(|Δsemitones| / 12, 1)
            one voiced    → 1
            both unvoiced → 0
```

After finding the path, each component is averaged along it and turned into a similarity `s = clamp(1 − avg / k, 0, 1)` (with `k` a per-component calibration constant). Then:

```
score = round(100 · (wE·sE + wP·sP + wT·sT) · lengthFactor)
default weights: wE = 0.4, wP = 0.4, wT = 0.2
```

- If fewer than 20% of the original's frames are voiced (claps, clicks, whistles without clear pitch), the weights become `wE = 0.7, wP = 0, wT = 0.3` — rhythm matters, not melody.
- `lengthFactor` = 1 when the duration ratio (imitation/original) is within [0.6, 1.67], otherwise it decays linearly to 0.5 at ratios 0.3 / 3.3.
- Calibration constants `k` are tuned so that: identical input → 100; the same sound shifted in pitch by an octave → ≥ 90; the same shape at a different tempo within ±30% → ≥ 80; unrelated sounds → ≤ 35. These become test cases (§11).

The result includes the breakdown `{ rhythm: sE, pitch: sP, tone: sT }` as 0–100 integers for display.

CPU cost: 80×80 DTW ≈ 6 400 cells × up to 5 mimics — well under 1 ms, safe for Free plan CPU limits.

### 2.4 Trust model

The server never accepts a score from the client. It does accept client-computed *features*; a technical player could forge them. For a friends-only game this is an accepted trade-off (doing pitch analysis server-side risks Free plan CPU limits). The server still validates feature shape, length and value ranges (§6.3).

---

## 3. Architecture

```
Browser (single HTML)  ──HTTPS POST /api/rooms──►  Worker (index.ts)
        │                                              │ idFromName(code)
        └──WSS /api/rooms/:code/ws──────────────────►  GameRoom Durable Object
                                                       (one per room, SQLite-backed)
```

- The **Worker** serves the built HTML as a static asset at `/` and handles `/api/*`.
- **Room creation** is HTTP: `POST /api/rooms` → Worker generates a code, calls `init()` on that room's DO; if the DO is already initialized (code collision) it retries with a new code (max 5 tries). Returns `{ roomId }`. CORS: `Access-Control-Allow-Origin: *` (the HTML may be opened from `file://`, origin `null`).
- **Joining** is WebSocket: `GET /api/rooms/:code/ws` (upgrade). The Worker forwards to the DO. If the room does not exist the DO accepts the socket, sends `error ROOM_NOT_FOUND`, and closes (browsers cannot read HTTP status on a failed WS upgrade).
- The HTML can also be opened as a file; everything works except the shareable link.

### 3.1 Cloudflare Free plan specifics

- Durable Object class declared with `new_sqlite_classes` in the wrangler migration (only SQLite-backed DOs are available on Free).
- **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`); each socket carries `serializeAttachment({ playerId })`.
- **Alarms** (`ctx.storage.setAlarm`) drive every phase deadline and room expiry — never `setTimeout`, which does not survive hibernation.
- Because the DO may hibernate mid-phase (e.g. during a quiet 20 s `MIMIC`), all room state **and the current round's clips** are written to `ctx.storage` on every change and lazily reloaded after wake-up. Clips are deleted when the next round starts and when the game ends.

---

## 4. Backend (`backend/`)

```
backend/
├── src/
│   ├── index.ts        Worker entry: static assets, POST /api/rooms, WS routing, CORS
│   ├── GameRoom.ts     Durable Object: sockets, persistence, alarms, broadcasting (thin adapter)
│   ├── protocol.ts     Message types + validation of every client message
│   ├── game.ts         Pure room/game state machine (lobby, phases, rounds, scores, players)
│   ├── roomCode.ts     generateRoomCode()
│   ├── games/
│   │   ├── types.ts    MiniGame interface
│   │   └── mimic.ts    Mimic rules: phases, submissions, prompt list, scoring calls
│   └── scoring.ts      Feature preprocessing, DTW, similarity score
├── test/               vitest tests for scoring, protocol, game, mimic
├── wrangler.toml
├── package.json
└── tsconfig.json
```

### 4.1 Pure core, thin adapter

`game.ts` and `games/mimic.ts` are **pure**: functions take `(state, event, now)` and return `{ state, effects }`, where effects are `broadcast`, `send(playerId, …)`, `setAlarm(time)`, `storeClip`, `deleteClips`, `closeSocket`. `GameRoom.ts` only translates socket/alarm events into events for the core and executes the effects. This makes the whole game testable in plain Node without the Workers runtime.

### 4.2 Mini-game interface

```ts
interface MiniGame {
  id: string;                                   // "mimic"
  phases: readonly string[];                    // phases this game owns
  startRound(ctx): Result;                      // enter the first game phase of a round
  handleAction(ctx, playerId, action): Result;  // player_action routed here
  onDeadline(ctx): Result;                      // alarm fired for a game-owned phase
  onPlayerDisconnected(ctx, playerId): Result;
}
```

`game.ts` owns `LOBBY`, `ROUND_INTRO`, `ROUND_RESULT`, `GAME_RESULT` and round/score bookkeeping; the mini-game owns its inner phases (`PERFORM`, `MIMIC`) and produces the round result. Adding a mini-game = new file in `games/` + registration.

### 4.3 Room state (conceptual)

```ts
{
  id: "A7K2P",
  initialized: true,
  hostId: "p_8f31a",
  phase: "LOBBY" | "ROUND_INTRO" | "PERFORM" | "MIMIC" | "ROUND_RESULT" | "GAME_RESULT",
  phaseEndsAt: number | null,          // epoch ms, authoritative deadline
  settings: { cycles: 1 | 2 | 3 },
  round: 0, totalRounds: 0,
  players: { [id]: { id, name, avatar, score, isHost, connected, joinedAt,
                     sessionToken /* never broadcast */, disconnectedAt } },
  // avatar: { body: 0..3, color: 0..9, eyes: 0..3, hat: 0..5 }
  miniGame: "mimic",
  roundState: { performerId, prompt, submitted: string[], results?: ... },
  emptySince: number | null
}
```

---

## 5. Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── index.html          template with <!--STYLE--> and <!--SCRIPT--> slots
│   ├── styles.css
│   ├── main.js             bootstraps app
│   ├── config.js           SERVER_URL resolution (the only place the backend URL lives)
│   ├── strings.js          all UI text (Turkish), one object
│   ├── connection.js       createRoom(), connect(), send(), reconnect/backoff, handleMessage()
│   ├── state.js            local mirror of server state + subscribe/update
│   ├── screens/
│   │   ├── menu.js         nickname, avatar editor, create, join (prefills ?room=)
│   │   ├── lobby.js        code + copy link, player list, host badge, cycles picker, start, mic panel
│   │   ├── game.js         per-phase views: intro, perform, mimic, round result; header mic button
│   │   └── results.js      final standings, play again / leave
│   ├── audio/
│   │   ├── devices.js      list audio inputs, remember selected deviceId, devicechange
│   │   ├── recorder.js     getUserMedia (selected device) + AudioWorklet (Blob URL) PCM capture, 3 s cap, level meter
│   │   ├── resample.js     → 16 kHz mono
│   │   ├── features.js     pure: Float32Array → { energy, pitch, centroid }
│   │   ├── wav.js          pure: PCM16 WAV encode/decode (base64)
│   │   └── sfx.js          tiny synthesized UI sounds (WebAudio oscillators, no files)
│   ├── scene/
│   │   ├── stage.js        Three.js renderer, camera, lights, stage, 6 slots with mic stands, render loop
│   │   ├── character.js    procedural low-poly character from an avatar (body, color, eyes, hat) + animations
│   │   ├── avatarOptions.js option lists shared by editor and scene (counts must match server validation)
│   │   ├── director.js     maps room state / phase / playback levels → scene actions (spotlight, camera, bubbles)
│   │   └── labels.js       HTML overlays projected above heads (name, ✔, score, 💤)
│   └── ui/
│       ├── avatarEditor.js rotating preview + option pickers + randomize
│       ├── micPanel.js     reusable panel: permission, device dropdown, level meter
│       ├── curves.js       canvas: original vs imitation energy+pitch overlay
│       └── dom.js          helpers; all user text set via textContent (no innerHTML with names)
├── test/                   vitest: features, wav
├── prototype/              scene-only page (fake players, buttons to trigger phases) for tuning the look
├── build.mjs               esbuild bundle (IIFE, `three` bundled in, tree-shaken) + inline CSS/JS → dist/index.html and dist/mimic-party-mini.html
└── package.json
```

### 5.1 Server URL

`config.js`:

```js
// Production backend. Replace after first deploy.
const PRODUCTION_SERVER = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";
```

Resolution order: `?server=` query param → the page's own origin when served over http(s) (covers `wrangler dev` at `http://localhost:8787` and production) → `PRODUCTION_SERVER` when opened from `file://`. HTTP and WS URLs are both derived from this one value.

### 5.2 Audio capture

- MediaRecorder is **not** used (codec support differs across browsers, notably Safari).
- PCM is captured via an AudioWorklet loaded from a Blob URL, downsampled to 16 kHz mono, capped at 3 s.
- Leading/trailing silence (below -45 dBFS) is trimmed before features and encoding, so reaction time does not affect the score.
- Clip transport: 16-bit PCM WAV, base64 in the WebSocket JSON (≈96 KB raw / ≈128 KB base64 for 3 s; Cloudflare's WS message limit is 1 MiB).
- Microphone permission is requested from the lobby's "Test mic" button (with a live level meter), or at the latest when first recording. A denied mic shows a clear message; the player can still watch and listen.
- **Microphone selection:**
  - After permission is granted, `navigator.mediaDevices.enumerateDevices()` lists the `audioinput` devices. Browsers only expose device labels after permission, so the list is filled after the first grant.
  - The player picks one from a dropdown in the mic panel. The live level meter immediately switches to the chosen device, so they can check that it is the right one.
  - The choice is saved as `deviceId` in `localStorage` (a per-computer preference, unlike the per-tab session). On the next visit it is requested with `{ deviceId: { exact } }`. If that device is gone, the browser default is used and the dropdown shows it.
  - The list refreshes on the `devicechange` event (e.g. a USB mic plugged in).
  - The mic panel is available in the lobby and, during a game, from a mic button in the game header. It is disabled while recording.
  - The dropdown is hidden when there is only one input.
- Capture constraints: `echoCancellation`, `noiseSuppression` and `autoGainControl` are turned **off**. Those browser filters distort the loudness envelope and can suppress non-voice sounds (claps, whistles), which would hurt scoring.

### 5.3 Feature extraction (`features.js`)

At 16 kHz: hop 640 samples (40 ms), window 1024 samples (Hann).
- `energy`: RMS of the window, in dBFS.
- `pitch`: YIN, 70–1000 Hz, threshold 0.15; `0` if no confident estimate or frame below -45 dBFS.
- `centroid`: FFT magnitude spectrum centroid (small radix-2 FFT in the file).

### 5.4 UI

- Language: **Turkish**, all strings in `strings.js`.
- Playful, high-contrast, big buttons. Desktop layout: the 3D stage fills the window; HTML panels float over it (top bar: room code, round, timer, mic button; bottom: phase controls; side panel for round results). Minimum supported window 1024×640. Inline SVG icons, system font stack plus a playful heading weight — no external fonts.
- Big record button (click or **Space** to start, auto-stops at 3 s or click/Space to stop), live level meter, playback button, "Send" (**Enter**).
- The timer is rendered from the server's `endsAt`, corrected by a clock offset estimated from `pong` messages.
- Round result: per-player row with score, 3 sub-bars (rhythm / pitch / tone), play button, and a canvas overlay of the original's curves (bold) with the selected player's curves.
- Lobby shares both the code and a link `…/?room=A7K2P`.

### 5.5 Reconnect

- On `joined`, the client stores `{ roomId, sessionToken }` in **sessionStorage** (per tab, so several tabs in one browser can be separate players when testing).
- On an unexpected close, it reconnects with exponential backoff (0.5 s → 8 s) and sends `join_room` with the stored `sessionToken`.
- A page reload with a stored session auto-rejoins.

### 5.6 3D stage and characters

**Tech:** Three.js (npm `three`, bundled inline). All geometry is procedural — no model or texture files. Flat-shaded low-poly look (`MeshLambertMaterial`/`MeshToonMaterial`, `flatShading`), soft blob shadows under characters instead of real shadow maps, `devicePixelRatio` capped at 2.

**Stage:** a slightly curved (half-moon) stage with 6 fixed slots, each with a mic stand in front. Slot = join order. The camera looks slightly down from the front and sways gently. Empty slots show only the mic stand.

**Character** (`character.js`), built from the avatar:

| Option | Count | Values |
|---|---|---|
| `body` | 4 | bean (capsule), box, cone, ball |
| `color` | 10 | fixed bright palette |
| `eyes` | 4 | round, sleepy, angry, googly |
| `hat` | 6 | none, cap, party hat, crown, headphones, bow |

Every character has a simple mouth (scaled on Y to "talk") and a squash-and-stretch bounce. Animations: idle breathing/blinking, talk (mouth + bounce driven by a 0–1 level), jump, sleep (grey tint + 💤 label), celebrate.

**Scene per phase** (`director.js`):

| Phase | Scene |
|---|---|
| `LOBBY` | Joining characters hop onto their slot; host has a small star label. Avatar changes update live. |
| `ROUND_INTRO` | Spotlight swings to the performer; camera eases toward them; prompt shown in a speech bubble. |
| `PERFORM` | Performer's character "talks" on every screen: locally from the live mic level; on other screens it idles with a "recording…" bubble (no live audio is streamed). |
| `MIMIC` | When the original plays, the performer's character talks along with the clip's `energy` curve. A ✔ appears over each player once `submission_received` arrives. The local player's character talks with their live mic while recording. |
| `ROUND_RESULT` | Playing any clip makes that player's character talk along with it; scores pop up above heads; the best mimic jumps. |
| `GAME_RESULT` | Characters line up on a podium by rank; confetti. |

Lip-sync uses the clip's `energy` feature array (25 fps) — no extra data over the network.

**Avatar editor** (`avatarEditor.js`): on the main menu next to the nickname field, a rotating preview of the character with ◀ ▶ pickers per option and a 🎲 randomize button. First visit gets a random avatar. The avatar is saved in `localStorage` and can also be changed in the lobby.

**Labels:** names, ✔, scores and 💤 are HTML elements positioned by projecting each character's head position to screen space every frame (crisp text, no 3D font).

**WebGL unavailable:** show a short message asking to use a current Chrome/Edge/Firefox. No 2D fallback (desktop-only, known group).

---

## 6. WebSocket Protocol

All messages are JSON objects with a `type`. Malformed JSON and unknown types are ignored (unknown types) or answered with `error INVALID_MESSAGE` (malformed/invalid fields).

### 6.1 Client → Server

| type | fields | notes |
|---|---|---|
| `join_room` | `playerName`, `avatar`, `sessionToken?` | First message on a socket. With a valid token → reconnect as that player; otherwise join as new (if allowed). |
| `update_avatar` | `avatar` | `LOBBY` only. |
| `update_settings` | `cycles: 1\|2\|3` | Host only, `LOBBY` only. |
| `start_game` | — | Host only, `LOBBY` only, ≥ 2 connected players. |
| `player_action` | `action: { type: "submit_clip", audio: base64, features: {energy, pitch, centroid} }` | Routed to the active mini-game. |
| `return_to_lobby` | — | Host only, `GAME_RESULT` only. Resets scores ("play again"). |
| `leave_room` | — | Removes the player immediately. |
| `ping` | `t` (client time) | Keep-alive + clock sync. |

### 6.2 Server → Client

| type | fields | notes |
|---|---|---|
| `joined` | `player` (self, includes `sessionToken`), `room` | Only to the joining socket. |
| `room_state` | `room` (public snapshot: id, hostId, phase, phaseEndsAt, settings, round, totalRounds, players[id,name,avatar,score,isHost,connected], roundState public part) | Broadcast after any state change; the client's source of truth. |
| `phase_changed` | `phase`, `round`, `endsAt`, `data` | `data` per phase: `ROUND_INTRO {performerId, prompt}`, `PERFORM {performerId}`, `MIMIC {performerId, clip: {audio, features}}`. Sent together with `room_state`. |
| `submission_received` | `playerId` | Broadcast; lets everyone see who has submitted. |
| `round_result` | `round`, `performerId`, `original {audio, features}`, `results [{playerId, score, breakdown, audio, features}]`, `performerPoints`, `skipped?` | |
| `game_result` | `standings [{playerId, name, score, rank}]` | |
| `error` | `code`, `message` | |
| `pong` | `t` (echo), `serverTime` | |

### 6.3 Validation

- `playerName`: trimmed, 1–16 chars, control characters stripped; duplicate names get a numeric suffix ("Alex 2").
- `avatar`: object with exactly `body`, `color`, `eyes`, `hat`, each an integer in its range (§5.6). Invalid → `INVALID_MESSAGE`.
- `submit_clip`: right phase, right role (performer in `PERFORM`, non-performer in `MIMIC`), not already submitted, base64 decodes to a valid 16 kHz mono PCM16 WAV ≤ 110 KB, 1–80 frames, all three arrays the same length, all values finite (`energy` ∈ [-120, 0], `pitch` ∈ {0} ∪ [50, 1200], `centroid` ∈ [0, 8000]).
- Message size cap 256 KB; rate limit per socket: token bucket 10 msg/s, burst 20. Excess messages are dropped with `error RATE_LIMITED`; sustained abuse (> 100 dropped) closes the socket.
- The client never sends `playerId`, score, phase, round or host status; the socket's attachment determines identity.

### 6.4 Error codes

Server: `ROOM_NOT_FOUND`, `ROOM_FULL`, `INVALID_NAME`, `INVALID_MESSAGE`, `INVALID_ACTION`, `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `GAME_ALREADY_STARTED`, `INVALID_PHASE`, `ALREADY_SUBMITTED`, `RATE_LIMITED`, `SESSION_EXPIRED`.
Client-only: `CONNECTION_ERROR`, `MIC_DENIED`, `MIC_UNSUPPORTED`.
Each has a friendly Turkish message in `strings.js`; internal errors are never shown.

---

## 7. Rooms and Players

- Room code: 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `O 0 I 1 L`).
- Capacity: 6 players.
- Player IDs `p_` + 8 random hex chars; session tokens 128-bit random hex. Both server-generated. Tokens are never broadcast.
- New joins are rejected with `GAME_ALREADY_STARTED` outside `LOBBY`; reconnects via token are always allowed while the player record exists.

---

## 8. Disconnects, Host, Lifecycle

- **Disconnect:** player marked `connected: false`, broadcast. In `LOBBY` the player is removed after 60 s; during a game the record is kept until the game ends (so they can rejoin) but they receive 0 for missed submissions and their performer turns are skipped.
- **Performer disconnects during `PERFORM`/`ROUND_INTRO`:** the round is skipped (same as a `PERFORM` timeout, §2.1).
- **All remaining mimics submitted or disconnected:** `MIMIC` ends early.
- **Fewer than 2 connected players during a game:** the game ends and goes to `GAME_RESULT` with current scores.
- **Host leaves/disconnects:** host passes to the earliest-joined connected player.
- **Room expiry:** when no player is connected, `emptySince` is set and an alarm fires 10 minutes later; if still empty, `ctx.storage.deleteAll()` wipes the room (it then counts as not found).
- **Alarms:** a DO has one alarm; it is set to `min(phaseEndsAt, emptySince + 10 min, lobby disconnect removals)`, and on firing the core processes every due item.

---

## 9. Development & Deployment

- Root `package.json` with npm workspaces (`backend`, `frontend`) and scripts:
  - `npm run build` — build the frontend into `frontend/dist/`.
  - `npm run dev` — build frontend, then `wrangler dev` (serves HTML + API on `http://localhost:8787`). `localhost` is a secure context, so the mic works.
  - `npm test` — vitest in both workspaces.
  - `npm run deploy` — build + `wrangler deploy` (Free plan, `*.workers.dev`).
- `wrangler.toml`: `assets = { directory = "../frontend/dist", run_worker_first = ["/api/*"] }`, DO binding `GAME_ROOM` → `GameRoom`, migration `new_sqlite_classes = ["GameRoom"]`.
- A short `README.md` covers: install, dev, test, `wrangler login`, deploy, and where to set `PRODUCTION_SERVER`.

---

## 10. Non-Goals

As in the brief (§32): no accounts, database, matchmaking, chat, leaderboards, analytics, etc. Additionally out of scope for v1: phones/tablets and touch UI, spectator mode, player-to-player voting, custom prompt lists, multiple mini-games, server-side audio analysis, live audio streaming between players, imported 3D models.

---

## 11. Testing

Automated (vitest, plain Node):

- `scoring.ts` — synthetic feature sequences: identical → 100; pitch shifted +12 semitones → ≥ 90; tempo ±30% → ≥ 80; unrelated → ≤ 35; silent imitation → 0; unvoiced original uses rhythm-weighted formula; length factor boundaries.
- `features.js` — sine at 220 Hz → pitch ≈ 220 Hz (±2%); silence → all unvoiced, low energy; white noise → unvoiced, high centroid; hop/frame count correct.
- `wav.js` — encode → decode round-trip.
- `protocol.ts` — valid messages pass; each invalid field class rejected; name sanitization and suffixing; avatar ranges (and that they match `avatarOptions.js` counts).
- `game.ts` + `mimic.ts` — full game with fake clock: lobby join/leave, host transfer, start permissions, capacity, `GAME_ALREADY_STARTED`, phase sequence and deadlines, early `MIMIC` end, duplicate submission, wrong role/phase, performer disconnect skips round, game ends below 2 players, play again resets scores, reconnect by token, room expiry.

Manual:

- `npm run dev`, 3 browser tabs, full game with real microphone; verify overlay curves and that "same sound" scores clearly beat "different sound". Tune `k` constants here if needed.
- Mic selection: switch between the available inputs and confirm the level meter follows the selected mic; reload and confirm the choice is remembered; unplug the selected mic and confirm fallback to the default.
- Scene prototype: every body/eyes/hat/color combination renders; talk animation follows a playing clip; spotlight/camera/podium transitions look right; stays smooth with 6 characters.
- One full game on the deployed URL from two different computers.

---

## 12. Build Order

Follows the brief's phases, adjusted for this design:

1. Scaffold workspaces; Worker + DO + WebSocket echo/ping; static asset serving.
2. `game.ts` core: rooms, players, host, lobby, reconnect, protocol validation (tests first).
3. Phases, rounds, alarms, persistence in `GameRoom.ts`.
4. `scoring.ts` + `games/mimic.ts` (tests first).
5. **Scene prototype**: stage, characters, avatar options, animations, driven by fake data in `frontend/prototype/`. User reviews the look here before it is wired to the game.
6. Frontend: connection/state, menu with avatar editor, lobby on the stage.
7. Frontend audio: recorder, mic selection, features, WAV (tests for pure parts).
8. Frontend game flow: phase panels, director (spotlight, lip-sync, ✔, scores), curves overlay, results podium, sfx, polish.
9. Reliability pass: disconnects, reconnect, errors, rate limits.
10. Packaging: single-file build, README, deploy.

---

## 13. Deviations from the Original Brief

| Brief | This spec | Why |
|---|---|---|
| `create_room` over WebSocket | `POST /api/rooms`, then WebSocket | A WS connects to a specific room's DO; the room must exist first. |
| Separate `timer` message | `endsAt` in `phase_changed` / `room_state` | One source of truth for deadlines. |
| `ready` message | Removed | No use in the mimic game. |
| `room_created`, `room_joined`, `player_joined/left/updated`, `game_started`, `game_state`, `round_started`, `player_action_result` | Replaced by `joined`, `room_state`, `phase_changed`, `submission_received`, `round_result`, `game_result` | Full-snapshot `room_state` keeps clients simple and consistent; fewer message kinds. |
| Phases `COUNTDOWN`, `MINIGAME` | `ROUND_INTRO`, `PERFORM`, `MIMIC` | The mimic game needs two distinct timed sub-phases. |
| HTML opened as a file | Also served by the Worker at `/` | A link is easier to share than a file. File mode still works. |
| Desktop, laptop and mobile | Desktop only | The group plays from computers only. |
| "Vanilla JS, no frameworks", assets minimized | Three.js bundled into the single HTML | The 3D stage (§5.6); Three.js is a rendering library, not a UI framework, and is inlined so the file stays self-contained. |
| — | Client computes audio features, server scores | Free plan CPU limits; see §2.4. |
