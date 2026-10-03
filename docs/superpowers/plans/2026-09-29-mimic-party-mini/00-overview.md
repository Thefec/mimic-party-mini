# Mimic Party Mini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-browser party game where players, shown as customizable low-poly 3D characters on a shared stage, imitate each other's recorded sounds. A Cloudflare Durable Object runs the game and scores imitations by audio similarity.

**Architecture:**
- **Backend:** A Cloudflare Worker routes `POST /api/rooms` and `WS /api/rooms/:code/ws` to one `GameRoom` Durable Object per room. All game rules live in pure TypeScript modules (`room.ts`, `game.ts`, `games/mimic.ts`, `scoring.ts`) that take a context and emit effects. `GameRoom.ts` is a thin adapter that handles sockets, storage and alarms.
- **Frontend:** Vanilla JS modules with Three.js for the stage, bundled by esbuild into a single self-contained HTML file. The Worker also serves this file as a static asset.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (SQLite-backed, WebSocket Hibernation, Alarms), wrangler, vitest, esbuild, Three.js, Web Audio API (AudioWorklet), happy-dom (one DOM test).

**Spec:** `docs/superpowers/specs/2026-09-29-mimic-party-mini-design.md`. Read it before starting any task.

## Plan files

The plan is split across files. Execute them in order:

| File | Tasks |
|---|---|
| `00-overview.md` | Header, constraints, review focus, file map |
| `01-scaffold.md` | Task 1 — workspaces, tooling, room codes |
| `02-protocol.md` | Task 2 — shared types, config, message validation |
| `03-scoring.md` | Task 3 — similarity scoring |
| `04-room-lobby.md` | Task 4 — room core: lobby, players, host, reconnect, expiry |
| `05-mimic-flow.md` | Task 5 — game flow and mimic mini-game |
| `06-adapter.md` | Task 6 — Durable Object adapter, Worker entry, rate limit, smoke test |
| `07-audio-dsp.md` | Task 7 — frontend scaffold + pure audio (resample, trim, features, WAV, clip) |
| `08-scene.md` | Task 8 — DOM helper, 3D stage, characters, labels, director, prototype page (**user review gate**) |
| `09-client-core.md` | Task 9 — config, strings, prefs, state, clock, connection |
| `10-audio-runtime.md` | Task 10 — audio context, mic devices, recorder, playback, sfx, mic panel, recorder widget, audio lab page |
| `11-menu-lobby.md` | Task 11 — styles, avatar editor, app shell, menu, lobby |
| `12-game-screens.md` | Task 12 — game screen, phase views, curves, results |
| `13-ship.md` | Task 13 — reliability pass, README, deploy, git (with user approval) |

## Global Constraints

- **No git commits during tasks.** The project is not a git repo yet. Git is set up in Task 13, and only after explicitly asking the user. Never add `Co-Authored-By` or any other Claude attribution to commits. Each task ends with a checkpoint (tests pass), not a commit.
- **Desktop browsers only:** current Chrome, Edge and Firefox. No mobile layout, touch handling or phone testing. Minimum window size is 1024×640.
- **Node ≥ 22** (machine has v22.18.0), npm workspaces `backend` and `frontend`.
- **Cloudflare Workers Free plan:** use `new_sqlite_classes`, the WebSocket Hibernation API (`ctx.acceptWebSocket`), and `ctx.storage.setAlarm` for timers. Never use `setTimeout` on the server.
- **Server-authoritative.** The client never sends a score, `playerId`, phase, round or host status. Identity comes from the socket attachment.
- **Room codes:** 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Maximum 6 players per room, minimum 2 to start.
- **Timings:** `ROUND_INTRO` 3 s, `PERFORM` 12 s, `MIMIC` 20 s, `ROUND_RESULT` 12 s (skipped round: 4 s). A player disconnected in the lobby is removed after 60 s. An empty room expires after 10 min.
- **Audio format:** clips are 16 kHz mono PCM16 WAV, base64, at most 3.2 s (80 frames) and ≤ 110 KB. Features are sent at 25 frames/s (hop 640, window 1024).
- **Avatar ranges:** `body` 0..3, `color` 0..9, `eyes` 0..3, `hat` 0..5.
- **UI text is Turkish** and lives only in `frontend/src/strings.js`. The backend URL lives only in `frontend/src/config.js`.
- **User-provided text is rendered via `textContent` / text nodes only.** Never `innerHTML` with names.
- **No external runtime assets:** no fonts, images or CDNs. Three.js is bundled into the HTML.

## Review Focus

These five inputs are implied by the spec but easy to miss. Each one has a dedicated test in the task named at the end of its line.

1. **Page reload in the middle of `MIMIC`:** the player rejoins with their session token, gets the original clip in `joined.phaseData`, and can still submit. (Task 5)
2. **Late or duplicate submissions:** a submission that arrives after the phase has ended gets `INVALID_PHASE`, and a second submission gets `ALREADY_SUBMITTED`. Scores never change twice. (Task 5)
3. **Host leaves on the results screen:** the host passes to another player, who can press "play again" (`return_to_lobby`). (Task 5)
4. **Silent or too-short recordings:** the client refuses them (`makeClip` → `null`, shows "too quiet"), and the server scores a near-silent imitation as 0. (Tasks 3 and 7)
5. **Hostile nicknames:** names containing HTML, bidi overrides or zero-width characters are sanitized by the server, and the client renders them as text, never as markup. (Tasks 2 and 8)

## File Map

```
mimic/
├── package.json                      root workspaces + scripts (Task 1)
├── .gitignore                        (Task 1)
├── README.md                         (Task 13)
├── backend/
│   ├── package.json, tsconfig.json, wrangler.toml      (Task 1)
│   ├── worker-configuration.d.ts     generated by `wrangler types` (Task 1)
│   ├── scripts/smoke.mjs             live end-to-end check against wrangler dev (Task 6)
│   ├── src/
│   │   ├── random.ts                 cryptoRandom, randomHex (Task 1)
│   │   ├── roomCode.ts               generateRoomCode, isRoomCode (Task 1)
│   │   ├── config.ts                 all numeric constants (Task 2)
│   │   ├── types.ts                  shared types + message unions (Task 2)
│   │   ├── protocol.ts               parse/validate client messages, names, avatars, clips, errors (Task 2)
│   │   ├── scoring.ts                feature prep, DTW, score (Task 3)
│   │   ├── room.ts                   Ctx/Effect, state factory, public views, setPhase, host (Task 4)
│   │   ├── game.ts                   lifecycle: join/leave/disconnect/alarm/start/rounds/end (Tasks 4–5)
│   │   ├── games/types.ts            MiniGame interface (Task 5)
│   │   ├── games/mimic.ts            mimic rules + prompts (Task 5)
│   │   ├── rateLimit.ts              TokenBucket (Task 6)
│   │   ├── GameRoom.ts               Durable Object adapter (Task 6)
│   │   └── index.ts                  Worker entry (Task 6)
│   └── test/
│       ├── roomCode.test.ts, random.test.ts   (Task 1)
│       ├── fixtures.ts, protocol.test.ts      (Task 2)
│       ├── scoring.test.ts                    (Task 3)
│       ├── harness.ts, lobby.test.ts          (Task 4)
│       ├── mimic.test.ts                      (Task 5)
│       └── rateLimit.test.ts                  (Task 6)
└── frontend/
    ├── package.json, build.mjs                (Task 1; build.mjs final in Task 7)
    ├── src/
    │   ├── index.html                         (Task 1)
    │   ├── styles.css                         (Task 1 stub, final in Task 11)
    │   ├── main.js                            (Task 1 stub, final in Task 11)
    │   ├── config.js, strings.js, prefs.js, state.js, clock.js, connection.js   (Task 9)
    │   ├── audio/
    │   │   ├── resample.js, features.js, wav.js, clip.js      (Task 7)
    │   │   └── audioContext.js, devices.js, recorder.js, player.js, sfx.js   (Task 10)
    │   ├── scene/
    │   │   ├── avatarOptions.js, character.js, stage.js, labels.js, director.js   (Task 8)
    │   ├── ui/
    │   │   ├── dom.js                         (Task 8 — needed by labels)
    │   │   ├── micPanel.js, recorderWidget.js (Task 10)
    │   │   ├── avatarEditor.js                (Task 11)
    │   │   └── curves.js                      (Task 12)
    │   └── screens/
    │       ├── util.js, menu.js, lobby.js     (Task 11)
    │       ├── game.js, results.js            (Task 11 stubs, final in Task 12)
    │       └── phases/intro.js, perform.js, mimic.js, roundResult.js   (Task 12)
    ├── prototype/index.html, prototype.js     (Task 8)
    ├── prototype/audio.html, audio.js         (Task 10 — mic + scoring lab)
    └── test/
        ├── resample.test.js, features.test.js, wav.test.js, clip.test.js   (Task 7)
        ├── avatarOptions.test.js, dom.test.js (Task 8)
        └── config.test.js, clock.test.js      (Task 9)
```

Note: `room.ts`/`game.ts` refine the spec's `game.ts` into two files. `room.ts` holds shared helpers that both `game.ts` and `games/mimic.ts` import, which avoids a circular import.
