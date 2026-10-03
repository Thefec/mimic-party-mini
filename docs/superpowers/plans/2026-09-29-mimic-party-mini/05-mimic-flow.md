# Task 5: Game flow and the mimic mini-game

**Files:**
- Create: `backend/src/games/types.ts`, `backend/src/games/mimic.ts`
- Modify: `backend/src/game.ts` (replace the three `GAME-FLOW` placeholders, add flow functions)
- Test: `backend/test/mimic.test.ts`

**Interfaces:**
- Consumes: everything in `room.ts` (Task 4), `validateClip` (Task 2), `scoreImitation` (Task 3), `Harness`/`errors`/`sent`/`replies` (Task 4), fixtures (Task 2).
- Produces:
  - `games/types.ts`: `interface RoundOutcome { skipped: boolean }`, `interface MiniGame { id; prepareRound(ctx); startRound(ctx); handleAction(ctx, playerId, action): RoundOutcome | null; onDeadline(ctx): RoundOutcome | null; onPlayerDisconnected(ctx, playerId): RoundOutcome | null }`
  - `games/mimic.ts`: `mimic: MiniGame`, `PROMPTS: string[]`
  - `game.ts`: `computeStandings(state): Standing[]` (exported for tests); start/round/finish/end/return-to-lobby flow.

Flow (spec §2.1, §8):
1. `start_game` → build the performer queue → `startNextRound` → `ROUND_INTRO` (3 s).
2. Alarm → `mimic.startRound` → `PERFORM` (12 s).
3. Performer submits → `MIMIC` (20 s), with the clip in the phase data.
4. Every connected mimic has submitted, or the deadline passes → `finishRound` → `ROUND_RESULT` (12 s, or 4 s if skipped) + `round_result`.
5. Alarm → next round, or `GAME_RESULT` + `game_result`.

- [ ] **Step 1: Mini-game interface**

`backend/src/games/types.ts`:
```ts
import type { Ctx } from "../room";

/** Returned by a mini-game when the current round is over. Round data lives in ctx.state.roundState. */
export interface RoundOutcome { skipped: boolean; }

export interface MiniGame {
  id: string;
  /** Called when a round is set up, before ROUND_INTRO. Fill roundState.prompt etc. */
  prepareRound(ctx: Ctx): void;
  /** ROUND_INTRO is over: enter the game's first phase. */
  startRound(ctx: Ctx): void;
  handleAction(ctx: Ctx, playerId: string, action: Record<string, unknown> & { type: string }): RoundOutcome | null;
  /** The current game-owned phase hit its deadline. */
  onDeadline(ctx: Ctx): RoundOutcome | null;
  /** A player disconnected or left during a game-owned phase (may already be removed from state). */
  onPlayerDisconnected(ctx: Ctx, playerId: string): RoundOutcome | null;
}
```

- [ ] **Step 2: Write failing tests**

`backend/test/mimic.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { INTRO_MS, MIMIC_MS, PERFORM_MS, RESULT_MS, SKIPPED_RESULT_MS } from "../src/config";
import type { Conn } from "../src/room";
import type { Clip } from "../src/types";
import { clip, HICCUPS } from "./fixtures";
import { errors, Harness, replies, sent } from "./harness";

let h: Harness;
beforeEach(() => { h = new Harness(); });

interface P { conn: Conn; id: string; token: string; }

function players(n: number): P[] {
  return ["A", "B", "C", "D", "E", "F"].slice(0, n).map((name) => {
    const { conn, effects } = h.join(name);
    return { conn, id: conn.playerId!, token: replies(effects, "joined")[0].player.sessionToken };
  });
}

function start(ps: P[], cycles: 1 | 2 | 3 = 1) {
  if (cycles !== 1) h.send(ps[0].conn, { type: "update_settings", cycles });
  return h.send(ps[0].conn, { type: "start_game" });
}

const submit = (p: P, c: Clip = clip()) =>
  h.send(p.conn, { type: "player_action", action: { type: "submit_clip", audio: c.audio, features: c.features } });

describe("starting", () => {
  it("needs the host and two connected players", () => {
    const [a] = players(1);
    expect(errors(start([a]))).toEqual(["NOT_ENOUGH_PLAYERS"]);
    const b = players(1)[0]; // joins as "A 2", not the host
    expect(errors(h.send(b.conn, { type: "start_game" }))).toEqual(["NOT_HOST"]);
  });

  it("builds players x cycles rounds and opens ROUND_INTRO for the first player", () => {
    const ps = players(3);
    const effects = start(ps, 2);
    expect(h.state.totalRounds).toBe(6);
    expect(h.state.round).toBe(1);
    expect(h.state.phase).toBe("ROUND_INTRO");
    expect(h.state.phaseEndsAt).toBe(h.now + INTRO_MS);
    const [changed] = sent(effects, "phase_changed");
    expect(changed.data).toMatchObject({ performerId: ps[0].id });
    expect(typeof (changed.data as { prompt: string }).prompt).toBe("string");
    expect(errors(h.join("Late").effects)).toEqual(["GAME_ALREADY_STARTED"]);
    expect(errors(h.join("Late", { sessionToken: "e".repeat(32) }).effects)).toEqual(["SESSION_EXPIRED"]);
  });
});

describe("a round", () => {
  it("runs INTRO -> PERFORM -> MIMIC -> ROUND_RESULT and scores it", () => {
    const [a, b] = players(2);
    start([a, b]);
    h.advance(INTRO_MS);
    expect(h.state.phase).toBe("PERFORM");

    const perform = submit(a);
    const [toMimic] = sent(perform, "phase_changed");
    expect(toMimic.phase).toBe("MIMIC");
    expect(toMimic.endsAt).toBe(h.now + MIMIC_MS);
    expect((toMimic.data as { clip: Clip }).clip.audio).toBe(clip().audio);

    const mimicked = submit(b);
    expect(sent(mimicked, "submission_received")).toEqual([{ type: "submission_received", playerId: b.id }]);
    const [result] = sent(mimicked, "round_result");
    expect(result).toMatchObject({ round: 1, performerId: a.id, skipped: false, performerPoints: 50 });
    expect(result.results).toEqual([
      expect.objectContaining({ playerId: b.id, submitted: true, score: 100 }),
    ]);
    expect(h.state.phase).toBe("ROUND_RESULT");
    expect(h.state.phaseEndsAt).toBe(h.now + RESULT_MS);
    expect(sent(mimicked, "phase_changed").find((m) => m.phase === "ROUND_RESULT")?.data).toBeNull();
    expect(h.player(a.conn).score).toBe(50);
    expect(h.player(b.conn).score).toBe(100);

    h.advance(RESULT_MS);
    expect(h.state.phase).toBe("ROUND_INTRO");
    expect(h.state.roundState.performerId).toBe(b.id);
    expect(h.state.roundState.submissions).toEqual({});
  });

  it("enforces roles, phases and single submissions (late/duplicate submissions change nothing)", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    expect(errors(submit(a))).toEqual(["INVALID_PHASE"]); // still ROUND_INTRO
    h.advance(INTRO_MS);
    expect(errors(submit(b))).toEqual(["INVALID_ACTION"]); // not the performer
    expect(errors(h.send(a.conn, { type: "player_action", action: { type: "dance" } }))).toEqual(["INVALID_ACTION"]);
    expect(errors(h.send(a.conn, { type: "player_action", action: { type: "submit_clip", audio: "x", features: {} } }))).toEqual(["INVALID_MESSAGE"]);
    submit(a);
    expect(errors(submit(a))).toEqual(["INVALID_ACTION"]); // performer cannot mimic
    submit(b);
    expect(errors(submit(b))).toEqual(["ALREADY_SUBMITTED"]);
    submit(c, clip(HICCUPS));
    expect(h.state.phase).toBe("ROUND_RESULT");
    const scores = h.state.order.map((id) => h.state.players[id].score);
    expect(errors(submit(c))).toEqual(["INVALID_PHASE"]);
    expect(h.state.order.map((id) => h.state.players[id].score)).toEqual(scores);
  });

  it("skips the round when the performer never submits", () => {
    const [a, b] = players(2);
    start([a, b]);
    const effects = h.advance(INTRO_MS + PERFORM_MS);
    const [result] = sent(effects, "round_result");
    expect(result).toMatchObject({ skipped: true, performerPoints: 0, results: [], original: null });
    expect(h.state.phaseEndsAt).toBe(h.now + SKIPPED_RESULT_MS);
    h.advance(SKIPPED_RESULT_MS);
    expect(h.state.round).toBe(2);
    expect(h.state.roundState.performerId).toBe(b.id);
  });

  it("gives 0 to mimics who miss the MIMIC deadline", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    h.advance(INTRO_MS);
    submit(a);
    submit(b);
    const [result] = sent(h.advance(MIMIC_MS), "round_result");
    expect(result.results.find((r) => r.playerId === c.id)).toEqual({ playerId: c.id, submitted: false, score: 0, breakdown: null, clip: null });
    expect(result.performerPoints).toBe(50);
  });
});

describe("disconnects during a game", () => {
  it("skips the round if the performer drops during ROUND_INTRO", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    const [result] = sent(h.disconnect(a.conn), "round_result");
    expect(result.skipped).toBe(true);
  });

  it("skips the round if the performer drops during PERFORM", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    h.advance(INTRO_MS);
    expect(sent(h.disconnect(a.conn), "round_result")[0].skipped).toBe(true);
  });

  it("ends MIMIC early when the last pending mimic drops", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    h.advance(INTRO_MS);
    submit(a);
    submit(b);
    expect(h.state.phase).toBe("MIMIC");
    const [result] = sent(h.disconnect(c.conn), "round_result");
    expect(result.results.find((r) => r.playerId === c.id)?.submitted).toBe(false);
  });

  it("ends the game when fewer than two players remain connected", () => {
    const [a, b] = players(2);
    start([a, b]);
    h.advance(INTRO_MS);
    const [gameResult] = sent(h.disconnect(b.conn), "game_result");
    expect(h.state.phase).toBe("GAME_RESULT");
    expect(h.state.phaseEndsAt).toBeNull();
    expect(gameResult.standings.map((s) => s.playerId).sort()).toEqual([a.id, b.id].sort());
    expect(h.state.players[b.id]).toBeUndefined(); // disconnected players are dropped after standings
  });

  it("lets a player reload mid-MIMIC, get the original clip, and still submit", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    h.advance(INTRO_MS);
    submit(a);
    h.disconnect(b.conn);
    const again = h.join("B", { sessionToken: b.token });
    const [joined] = replies(again.effects, "joined");
    expect(joined.room.phase).toBe("MIMIC");
    expect((joined.phaseData as { clip: Clip }).clip.audio).toBe(clip().audio);
    const effects = h.send(again.conn, { type: "player_action", action: { type: "submit_clip", audio: clip().audio, features: clip().features } });
    expect(sent(effects, "submission_received")).toEqual([{ type: "submission_received", playerId: b.id }]);
  });

  it("skips the performer turn of a player who is disconnected when it comes up", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    h.disconnect(c.conn);
    h.advance(INTRO_MS);
    submit(a);
    submit(b); // c is disconnected, so the round ends
    h.advance(RESULT_MS + INTRO_MS);
    submit(b);
    submit(a);
    const effects = h.advance(RESULT_MS);
    expect(sent(effects, "game_result")).toHaveLength(1);
    expect(h.state.totalRounds).toBe(2);
  });
});

describe("game end", () => {
  it("plays every round, ranks with ties, and ends in GAME_RESULT", () => {
    const [a, b, c] = players(3);
    start([a, b, c]);
    // Round 1: A performs, B and C imitate perfectly.
    h.advance(INTRO_MS); submit(a); submit(b); submit(c);
    h.advance(RESULT_MS);
    // Round 2: B performs.
    h.advance(INTRO_MS); submit(b); submit(a); submit(c);
    h.advance(RESULT_MS);
    // Round 3: C performs, only A imitates.
    h.advance(INTRO_MS); submit(c); submit(a);
    h.advance(MIMIC_MS);
    const [gameResult] = sent(h.advance(RESULT_MS), "game_result");
    expect(h.state.phase).toBe("GAME_RESULT");
    // A: 50 + 100 + 100 = 250, B: 100 + 50 + 0 = 150, C: 100 + 100 + 50 = 250
    expect(gameResult.standings).toEqual([
      { playerId: a.id, name: "A", score: 250, rank: 1 },
      { playerId: c.id, name: "C", score: 250, rank: 1 },
      { playerId: b.id, name: "B", score: 150, rank: 3 },
    ]);
  });

  it("if the host leaves on the results screen, the new host can play again", () => {
    const [a, b] = players(2);
    start([a, b]);
    h.advance(INTRO_MS); submit(a); submit(b); h.advance(RESULT_MS);
    h.advance(INTRO_MS); submit(b); submit(a); h.advance(RESULT_MS);
    expect(h.state.phase).toBe("GAME_RESULT");
    expect(errors(h.send(b.conn, { type: "return_to_lobby" }))).toEqual(["NOT_HOST"]);
    h.send(a.conn, { type: "leave_room" });
    expect(h.state.hostId).toBe(b.id);
    const effects = h.send(b.conn, { type: "return_to_lobby" });
    expect(sent(effects, "phase_changed")[0].phase).toBe("LOBBY");
    expect(h.state.phase).toBe("LOBBY");
    expect(h.player(b.conn).score).toBe(0);
    expect(h.state.round).toBe(0);
    expect(h.state.standings).toBeNull();
    expect(errors(h.send(b.conn, { type: "return_to_lobby" }))).toEqual(["INVALID_PHASE"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w backend -- mimic`
Expected: FAIL — cannot resolve `../src/games/...`, or assertions fail with `INVALID_ACTION` from the Task 4 placeholders.

- [ ] **Step 4: Implement `games/mimic.ts`**

`backend/src/games/mimic.ts`:
```ts
import { MIMIC_MS, PERFORM_MS } from "../config";
import { validateClip } from "../protocol";
import { broadcast, connectedIds, sendError, setPhase, type Ctx } from "../room";
import { scoreImitation } from "../scoring";
import type { RoomState } from "../types";
import type { MiniGame, RoundOutcome } from "./types";

export const PROMPTS = [
  "Kedi", "Siren", "Robot", "Kötü kahkaha", "Horoz", "Eski modem", "Araba kornası", "Hapşırık",
  "Opera sanatçısı", "Dinozor", "Kapı gıcırtısı", "Uzaylı", "Tavuk", "Kurt uluması", "Motor sesi",
  "Su damlası", "Yavru köpek", "Zombi", "Lazer silahı", "Keçi", "Tren düdüğü", "Ördek", "Esneme", "Balon patlaması",
];

function allMimicsDone(s: RoomState): boolean {
  const rs = s.roundState;
  return connectedIds(s).every((id) => id === rs.performerId || rs.submissions[id] !== undefined);
}

export const mimic: MiniGame = {
  id: "mimic",

  prepareRound(ctx) {
    ctx.state.roundState.prompt = PROMPTS[Math.floor(ctx.random() * PROMPTS.length)];
  },

  startRound(ctx) {
    setPhase(ctx, "PERFORM", PERFORM_MS);
  },

  handleAction(ctx: Ctx, playerId, action): RoundOutcome | null {
    if (action.type !== "submit_clip") {
      sendError(ctx, "INVALID_ACTION");
      return null;
    }
    const s = ctx.state;
    const rs = s.roundState;

    if (s.phase === "PERFORM") {
      if (playerId !== rs.performerId) {
        sendError(ctx, "INVALID_ACTION");
        return null;
      }
      const clip = validateClip(action);
      if (!clip) {
        sendError(ctx, "INVALID_MESSAGE");
        return null;
      }
      rs.original = clip;
      setPhase(ctx, "MIMIC", MIMIC_MS);
      return null;
    }

    // MIMIC
    if (playerId === rs.performerId) {
      sendError(ctx, "INVALID_ACTION");
      return null;
    }
    if (rs.submissions[playerId]) {
      sendError(ctx, "ALREADY_SUBMITTED");
      return null;
    }
    const clip = validateClip(action);
    if (!clip) {
      sendError(ctx, "INVALID_MESSAGE");
      return null;
    }
    const { score, breakdown } = scoreImitation(rs.original!.features, clip.features);
    rs.submissions[playerId] = { clip, score, breakdown };
    ctx.changed = true;
    broadcast(ctx, { type: "submission_received", playerId });
    return allMimicsDone(s) ? { skipped: false } : null;
  },

  onDeadline(ctx) {
    return { skipped: ctx.state.phase === "PERFORM" };
  },

  onPlayerDisconnected(ctx, playerId) {
    const s = ctx.state;
    if (s.phase === "PERFORM" && playerId === s.roundState.performerId) return { skipped: true };
    if (s.phase === "MIMIC" && allMimicsDone(s)) return { skipped: false };
    return null;
  },
};
```

- [ ] **Step 5: Wire the flow into `game.ts`**

5a. Replace the import block at the top of `backend/src/game.ts` with:
```ts
import {
  EMPTY_ROOM_EXPIRE_MS, INTRO_MS, LOBBY_DISCONNECT_REMOVE_MS, MAX_PLAYERS, MIN_PLAYERS, RESULT_MS, SKIPPED_RESULT_MS,
} from "./config";
import { mimic } from "./games/mimic";
import type { MiniGame, RoundOutcome } from "./games/types";
import { sanitizeName, uniqueName } from "./protocol";
import { randomHex } from "./random";
import {
  broadcast, connectedIds, currentPhaseData, emptyRoundState, ensureHost, publicPlayer, publicRoom, removePlayer,
  reply, sendError, setPhase, type Conn, type Ctx,
} from "./room";
import type { Avatar, ClientMessage, MimicResult, Player, RoomState, ServerMessage, Standing } from "./types";

const GAMES: Record<string, MiniGame> = { [mimic.id]: mimic };
const activeGame = (): MiniGame => GAMES.mimic;
```

5b. In `handleClientMessage`, replace:
```ts
    case "start_game":
    case "player_action":
    case "return_to_lobby":
      // GAME-FLOW: implemented in Task 5.
      return sendError(ctx, "INVALID_ACTION");
```
with:
```ts
    case "start_game":
      return startGame(ctx, playerId);
    case "player_action":
      return playerAction(ctx, playerId, msg.action);
    case "return_to_lobby":
      return returnToLobby(ctx, playerId);
```

5c. In `afterPlayerGone`, replace:
```ts
  if (!inGame(s)) return;
  // GAME-FLOW: in-game consequences implemented in Task 5.
  void playerId;
}
```
with:
```ts
  if (!inGame(s)) return;
  if (connectedIds(s).length < MIN_PLAYERS) return endGame(ctx);
  if (s.phase === "ROUND_INTRO" && s.roundState.performerId === playerId) return finishRound(ctx, { skipped: true });
  if (s.phase === "PERFORM" || s.phase === "MIMIC") {
    const outcome = activeGame().onPlayerDisconnected(ctx, playerId);
    if (outcome) finishRound(ctx, outcome);
  }
}
```

5d. In `handleAlarm`, replace:
```ts
  // GAME-FLOW: phase deadlines implemented in Task 5.
}
```
with:
```ts
  if (s.phaseEndsAt !== null && now >= s.phaseEndsAt) onPhaseDeadline(ctx);
}

function onPhaseDeadline(ctx: Ctx): void {
  switch (ctx.state.phase) {
    case "ROUND_INTRO":
      return activeGame().startRound(ctx);
    case "PERFORM":
    case "MIMIC": {
      const outcome = activeGame().onDeadline(ctx);
      if (outcome) finishRound(ctx, outcome);
      return;
    }
    case "ROUND_RESULT":
      return startNextRound(ctx);
  }
}
```

5e. Append the flow section to the end of `game.ts`:
```ts
// ---------------------------------------------------------------- game flow

function startGame(ctx: Ctx, playerId: string): void {
  const s = ctx.state;
  if (s.hostId !== playerId) return sendError(ctx, "NOT_HOST");
  if (s.phase !== "LOBBY") return sendError(ctx, "INVALID_PHASE");
  const ids = connectedIds(s);
  if (ids.length < MIN_PLAYERS) return sendError(ctx, "NOT_ENOUGH_PLAYERS");

  for (const id of [...s.order]) if (!s.players[id].connected) removePlayer(s, id);
  for (const id of s.order) s.players[id].score = 0;
  s.performerQueue = Array.from({ length: s.settings.cycles }, () => ids).flat();
  s.totalRounds = s.performerQueue.length;
  s.round = 0;
  s.standings = null;
  ctx.changed = true;
  startNextRound(ctx);
}

function startNextRound(ctx: Ctx): void {
  const s = ctx.state;
  s.roundState = emptyRoundState();
  while (s.performerQueue.length && !s.players[s.performerQueue[0]]?.connected) {
    s.performerQueue.shift();
    s.totalRounds--;
  }
  if (!s.performerQueue.length || connectedIds(s).length < MIN_PLAYERS) return endGame(ctx);
  s.round++;
  s.roundState.performerId = s.performerQueue.shift()!;
  activeGame().prepareRound(ctx);
  setPhase(ctx, "ROUND_INTRO", INTRO_MS);
}

function playerAction(ctx: Ctx, playerId: string, action: Record<string, unknown> & { type: string }): void {
  const phase = ctx.state.phase;
  if (phase !== "PERFORM" && phase !== "MIMIC") return sendError(ctx, "INVALID_PHASE");
  const outcome = activeGame().handleAction(ctx, playerId, action);
  if (outcome) finishRound(ctx, outcome);
}

function finishRound(ctx: Ctx, outcome: RoundOutcome): void {
  const s = ctx.state;
  const rs = s.roundState;
  const performerId = rs.performerId!;
  const results: MimicResult[] = outcome.skipped
    ? []
    : s.order
        .filter((id) => id !== performerId)
        .map((id) => {
          const sub = rs.submissions[id];
          return sub
            ? { playerId: id, submitted: true, score: sub.score, breakdown: sub.breakdown, clip: sub.clip }
            : { playerId: id, submitted: false, score: 0, breakdown: null, clip: null };
        });
  const submitted = results.filter((r) => r.submitted).map((r) => r.score);
  const performerPoints = submitted.length
    ? Math.round((submitted.reduce((a, b) => a + b, 0) / submitted.length) * 0.5)
    : 0;

  for (const r of results) s.players[r.playerId].score += r.score;
  if (s.players[performerId]) s.players[performerId].score += performerPoints;

  rs.result = {
    round: s.round,
    performerId,
    skipped: outcome.skipped,
    original: outcome.skipped ? null : rs.original,
    results,
    performerPoints,
  };
  setPhase(ctx, "ROUND_RESULT", outcome.skipped ? SKIPPED_RESULT_MS : RESULT_MS);
  broadcast(ctx, { type: "round_result", ...rs.result });
}

export function computeStandings(s: RoomState): Standing[] {
  const list = s.order.map((id) => ({ playerId: id, name: s.players[id].name, score: s.players[id].score }));
  list.sort((a, b) => b.score - a.score);
  return list.map((x) => ({ ...x, rank: 1 + list.filter((y) => y.score > x.score).length }));
}

function endGame(ctx: Ctx): void {
  const s = ctx.state;
  s.standings = computeStandings(s);
  for (const id of [...s.order]) if (!s.players[id].connected) removePlayer(s, id);
  ensureHost(s);
  s.roundState = emptyRoundState();
  s.performerQueue = [];
  setPhase(ctx, "GAME_RESULT", null);
  broadcast(ctx, { type: "game_result", standings: s.standings });
}

function returnToLobby(ctx: Ctx, playerId: string): void {
  const s = ctx.state;
  if (s.hostId !== playerId) return sendError(ctx, "NOT_HOST");
  if (s.phase !== "GAME_RESULT") return sendError(ctx, "INVALID_PHASE");
  for (const id of [...s.order]) if (!s.players[id].connected) removePlayer(s, id);
  for (const id of s.order) s.players[id].score = 0;
  s.round = 0;
  s.totalRounds = 0;
  s.standings = null;
  s.roundState = emptyRoundState();
  setPhase(ctx, "LOBBY", null);
}
```

Standings are computed from `s.order`, which is join order, and the sort is stable. So tied players keep their join order, and the tie test expects A before C.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: PASS (all files).

If "skips the performer turn…" fails: check the step order. Round 1 ends as soon as B submits, because C is disconnected. Round 2's performer is B, and it ends when A submits. The next `advance(RESULT_MS)` then finds C, who is disconnected, drops them from the queue, and ends the game.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no errors outside `worker-configuration.d.ts`.

- [ ] **Step 8: Checkpoint**

All backend tests pass. No commit.
