# Task 4: Room core — lobby, players, host, reconnect, expiry

**Files:**
- Create: `backend/src/room.ts`, `backend/src/game.ts`
- Create: `backend/test/harness.ts`
- Test: `backend/test/lobby.test.ts`

**Interfaces:**
- Consumes: config constants and `sanitizeName`, `uniqueName`, `errorMessage` (Task 2); `randomHex` (Task 1).
- Produces:
  - `room.ts`:
    - `interface Conn { playerId: string | null }`
    - `type Effect = reply | bind | send | broadcast | closeCurrent | closePlayer | wipe` (exact shapes below)
    - `interface Ctx { state: RoomState; now: number; random: () => number; effects: Effect[]; changed: boolean }`
    - `createRoomState(id)`, `emptyRoundState()`, `reply(ctx, msg)`, `send(ctx, playerId, msg)`, `broadcast(ctx, msg)`, `sendError(ctx, code)`, `connectedIds(state)`, `ensureHost(state)`, `removePlayer(state, id)`, `publicPlayer(state, id)`, `publicRoom(state)`, `currentPhaseData(state)`, `setPhase(ctx, phase, durationMs | null)`
  - `game.ts`: `handleClientMessage(ctx, conn, msg)`, `handleSocketClosed(ctx, playerId)`, `handleAlarm(ctx)`, `nextWakeTime(state): number | null`
  - `test/harness.ts`: `class Harness` with `state`, `now`, `wiped`, `join(name, extra?)`, `send(conn, msg)`, `disconnect(conn)`, `advance(ms)`, and helpers `errors(effects)`, `sent(effects, type)`, `replies(effects, type)`.

Contract with the adapter (Task 6):
- The adapter builds a `Ctx`, calls one core function and executes `ctx.effects` in order.
- If `ctx.changed` is set, it then persists the state and broadcasts `room_state`.
- After every call it sets the alarm to `nextWakeTime(state)`.

- [ ] **Step 1: Implement `room.ts` (shared helpers, no behavior of its own to test directly)**

`backend/src/room.ts`:
```ts
import { errorMessage } from "./protocol";
import type { ErrorCode, Phase, PhaseData, PublicPlayer, PublicRoom, RoomState, RoundState, ServerMessage } from "./types";

export interface Conn { playerId: string | null; }

export type Effect =
  | { kind: "reply"; msg: ServerMessage }                 // to the socket that sent the message
  | { kind: "bind"; playerId: string }                    // attach the current socket to a player
  | { kind: "send"; playerId: string; msg: ServerMessage }
  | { kind: "broadcast"; msg: ServerMessage }             // to every joined socket
  | { kind: "closeCurrent" }
  | { kind: "closePlayer"; playerId: string }             // close that player's other sockets
  | { kind: "wipe" };                                     // room expired: delete everything

export interface Ctx {
  state: RoomState;
  now: number;
  random: () => number;
  effects: Effect[];
  changed: boolean;
}

export function emptyRoundState(): RoundState {
  return { performerId: null, prompt: null, original: null, submissions: {}, result: null };
}

export function createRoomState(id: string): RoomState {
  return {
    id,
    hostId: null,
    phase: "LOBBY",
    phaseEndsAt: null,
    settings: { cycles: 1 },
    round: 0,
    totalRounds: 0,
    players: {},
    order: [],
    performerQueue: [],
    roundState: emptyRoundState(),
    standings: null,
    emptySince: null,
  };
}

export const reply = (ctx: Ctx, msg: ServerMessage) => void ctx.effects.push({ kind: "reply", msg });
export const send = (ctx: Ctx, playerId: string, msg: ServerMessage) => void ctx.effects.push({ kind: "send", playerId, msg });
export const broadcast = (ctx: Ctx, msg: ServerMessage) => void ctx.effects.push({ kind: "broadcast", msg });
export const sendError = (ctx: Ctx, code: ErrorCode) => reply(ctx, errorMessage(code));

export function connectedIds(s: RoomState): string[] {
  return s.order.filter((id) => s.players[id]?.connected);
}

/** Keep the host if still connected; otherwise hand it to the earliest-joined connected player. */
export function ensureHost(s: RoomState): void {
  if (s.hostId && s.players[s.hostId]?.connected) return;
  const first = connectedIds(s)[0];
  if (first) s.hostId = first;
  else if (s.hostId && !s.players[s.hostId]) s.hostId = null;
}

export function removePlayer(s: RoomState, id: string): void {
  delete s.players[id];
  s.order = s.order.filter((x) => x !== id);
  s.performerQueue = s.performerQueue.filter((x) => x !== id);
  if (s.hostId === id) s.hostId = null;
}

export function publicPlayer(s: RoomState, id: string): PublicPlayer {
  const p = s.players[id];
  return { id, name: p.name, avatar: { ...p.avatar }, score: p.score, isHost: s.hostId === id, connected: p.connected };
}

export function publicRoom(s: RoomState): PublicRoom {
  return {
    id: s.id,
    hostId: s.hostId,
    phase: s.phase,
    phaseEndsAt: s.phaseEndsAt,
    settings: { ...s.settings },
    round: s.round,
    totalRounds: s.totalRounds,
    players: s.order.map((id) => publicPlayer(s, id)),
    performerId: s.roundState.performerId,
    submitted: Object.keys(s.roundState.submissions),
  };
}

/** Phase data for someone (re)joining now. Includes the heavy result payloads. */
export function currentPhaseData(s: RoomState): PhaseData {
  const rs = s.roundState;
  switch (s.phase) {
    case "ROUND_INTRO":
    case "PERFORM":
      return { performerId: rs.performerId!, prompt: rs.prompt ?? "" };
    case "MIMIC":
      return { performerId: rs.performerId!, clip: rs.original! };
    case "ROUND_RESULT":
      return rs.result;
    case "GAME_RESULT":
      return { standings: s.standings ?? [] };
    default:
      return null;
  }
}

/**
 * Enter a phase and announce it. Result phases carry their data in their own
 * message (round_result / game_result), so phase_changed.data is null for them.
 */
export function setPhase(ctx: Ctx, phase: Phase, durationMs: number | null): void {
  const s = ctx.state;
  s.phase = phase;
  s.phaseEndsAt = durationMs === null ? null : ctx.now + durationMs;
  ctx.changed = true;
  const data = phase === "ROUND_RESULT" || phase === "GAME_RESULT" ? null : currentPhaseData(s);
  broadcast(ctx, { type: "phase_changed", phase, round: s.round, endsAt: s.phaseEndsAt, data });
}
```

- [ ] **Step 2: Test harness**

`backend/test/harness.ts`:
```ts
import { handleAlarm, handleClientMessage, handleSocketClosed, nextWakeTime } from "../src/game";
import { createRoomState, type Conn, type Ctx, type Effect } from "../src/room";
import type { ClientMessage, ErrorCode, RoomState, ServerMessage } from "../src/types";
import { AVATAR } from "./fixtures";

export class Harness {
  state: RoomState = createRoomState("TEST1");
  now = 1_000_000;
  wiped = false;
  private seed = 42;

  random = () => {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  };

  run(fn: (ctx: Ctx) => void): Effect[] {
    const ctx: Ctx = { state: this.state, now: this.now, random: this.random, effects: [], changed: false };
    fn(ctx);
    if (ctx.effects.some((e) => e.kind === "wipe")) this.wiped = true;
    return ctx.effects;
  }

  send(conn: Conn, msg: ClientMessage): Effect[] {
    const effects = this.run((ctx) => handleClientMessage(ctx, conn, msg));
    for (const e of effects) if (e.kind === "bind") conn.playerId = e.playerId;
    return effects;
  }

  join(name: string, extra: Partial<Extract<ClientMessage, { type: "join_room" }>> = {}): { conn: Conn; effects: Effect[] } {
    const conn: Conn = { playerId: null };
    const effects = this.send(conn, { type: "join_room", playerName: name, avatar: AVATAR, ...extra });
    return { conn, effects };
  }

  /** Simulates the socket dropping (not a leave_room). */
  disconnect(conn: Conn): Effect[] {
    const id = conn.playerId!;
    conn.playerId = null;
    return this.run((ctx) => handleSocketClosed(ctx, id));
  }

  /** Move the clock forward, firing every alarm that comes due, at its due time. */
  advance(ms: number): Effect[] {
    const target = this.now + ms;
    const all: Effect[] = [];
    for (let guard = 0; guard < 1000 && !this.wiped; guard++) {
      const wake = nextWakeTime(this.state);
      if (wake === null || wake > target) break;
      this.now = Math.max(this.now, wake);
      all.push(...this.run((ctx) => handleAlarm(ctx)));
    }
    this.now = target;
    return all;
  }

  player(conn: Conn) {
    return this.state.players[conn.playerId!];
  }
}

export const errors = (effects: Effect[]): ErrorCode[] =>
  effects.flatMap((e) => (e.kind === "reply" && e.msg.type === "error" ? [e.msg.code] : []));

/** Messages of a given type that were broadcast. */
export const sent = <T extends ServerMessage["type"]>(effects: Effect[], type: T) =>
  effects.flatMap((e) => (e.kind === "broadcast" && e.msg.type === type ? [e.msg as Extract<ServerMessage, { type: T }>] : []));

/** Messages of a given type sent back to the current socket. */
export const replies = <T extends ServerMessage["type"]>(effects: Effect[], type: T) =>
  effects.flatMap((e) => (e.kind === "reply" && e.msg.type === type ? [e.msg as Extract<ServerMessage, { type: T }>] : []));
```

- [ ] **Step 3: Write failing lobby tests**

`backend/test/lobby.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { errors, Harness, replies } from "./harness";
import { AVATAR } from "./fixtures";

let h: Harness;
beforeEach(() => { h = new Harness(); });

describe("joining", () => {
  it("first player becomes host and receives a private session token", () => {
    const { conn, effects } = h.join("Alex");
    expect(conn.playerId).toMatch(/^p_[0-9a-f]{8}$/);
    const [joined] = replies(effects, "joined");
    expect(joined.player.sessionToken).toMatch(/^[0-9a-f]{32}$/);
    expect(joined.player.isHost).toBe(true);
    expect(joined.room.players).toHaveLength(1);
    expect(JSON.stringify(joined.room)).not.toContain(joined.player.sessionToken);
    expect(h.state.hostId).toBe(conn.playerId);
  });

  it("suffixes duplicate names and rejects invalid ones", () => {
    h.join("Alex");
    const { conn } = h.join("alex");
    expect(h.player(conn).name).toBe("alex 2");
    expect(errors(h.join("   ").effects)).toEqual(["INVALID_NAME"]);
  });

  it("rejects the 7th player", () => {
    for (let i = 0; i < 6; i++) h.join(`P${i}`);
    expect(errors(h.join("Late").effects)).toEqual(["ROOM_FULL"]);
  });

  it("rejects a second join_room on the same socket and anything but ping before joining", () => {
    const { conn } = h.join("Alex");
    expect(errors(h.send(conn, { type: "join_room", playerName: "Again", avatar: AVATAR }))).toEqual(["INVALID_ACTION"]);
    const stranger = { playerId: null };
    expect(errors(h.send(stranger, { type: "start_game" }))).toEqual(["INVALID_ACTION"]);
    expect(replies(h.send(stranger, { type: "ping", t: 5 }), "pong")[0]).toEqual({ type: "pong", t: 5, serverTime: h.now });
  });
});

describe("lobby settings", () => {
  it("only the host may change cycles, and anyone may change their own avatar", () => {
    const a = h.join("A").conn;
    const b = h.join("B").conn;
    expect(errors(h.send(b, { type: "update_settings", cycles: 3 }))).toEqual(["NOT_HOST"]);
    h.send(a, { type: "update_settings", cycles: 3 });
    expect(h.state.settings.cycles).toBe(3);
    h.send(b, { type: "update_avatar", avatar: { body: 1, color: 2, eyes: 3, hat: 4 } });
    expect(h.player(b).avatar).toEqual({ body: 1, color: 2, eyes: 3, hat: 4 });
  });
});

describe("disconnects and reconnects", () => {
  it("passes host to the earliest-joined connected player", () => {
    const a = h.join("A").conn;
    const b = h.join("B").conn;
    h.join("C");
    const aId = a.playerId!;
    h.disconnect(a);
    expect(h.state.hostId).toBe(b.playerId);
    expect(h.state.players[aId].connected).toBe(false);
  });

  it("reconnects by token as the same player and closes the old socket", () => {
    const first = h.join("A");
    h.join("B");
    const token = replies(first.effects, "joined")[0].player.sessionToken;
    const id = first.conn.playerId!;
    h.disconnect(first.conn);
    const again = h.join("ignored name", { sessionToken: token });
    expect(again.conn.playerId).toBe(id);
    expect(again.effects[0]).toEqual({ kind: "closePlayer", playerId: id });
    expect(h.state.players[id].connected).toBe(true);
    expect(h.state.players[id].name).toBe("A");
    expect(h.state.order).toHaveLength(2);
  });

  it("joins as a new player when an unknown token is used in the lobby", () => {
    const { conn } = h.join("A", { sessionToken: "f".repeat(32) });
    expect(conn.playerId).not.toBeNull();
  });

  it("removes a lobby player 60 s after they disconnect", () => {
    h.join("A");
    const b = h.join("B").conn;
    const bId = b.playerId!;
    h.disconnect(b);
    h.advance(59_000);
    expect(h.state.players[bId]).toBeDefined();
    h.advance(1_000);
    expect(h.state.players[bId]).toBeUndefined();
    expect(h.state.order).toHaveLength(1);
  });

  it("leave_room removes the player immediately and closes the socket", () => {
    h.join("A");
    const b = h.join("B").conn;
    const bId = b.playerId!;
    const effects = h.send(b, { type: "leave_room" });
    expect(effects).toContainEqual({ kind: "closeCurrent" });
    expect(h.state.players[bId]).toBeUndefined();
  });
});

describe("room expiry", () => {
  it("wipes the room 10 minutes after the last player disconnects", () => {
    const a = h.join("A").conn;
    h.disconnect(a);
    h.advance(9 * 60_000);
    expect(h.wiped).toBe(false);
    h.advance(60_000);
    expect(h.wiped).toBe(true);
  });

  it("a reconnect before expiry cancels it", () => {
    const first = h.join("A");
    const token = replies(first.effects, "joined")[0].player.sessionToken;
    h.disconnect(first.conn);
    h.advance(30_000);
    h.join("A", { sessionToken: token });
    h.advance(11 * 60_000);
    expect(h.wiped).toBe(false);
    expect(h.state.emptySince).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -w backend -- lobby`
Expected: FAIL — cannot resolve `../src/game`.

- [ ] **Step 5: Implement `game.ts` (lobby part)**

`backend/src/game.ts`:
```ts
import { EMPTY_ROOM_EXPIRE_MS, LOBBY_DISCONNECT_REMOVE_MS, MAX_PLAYERS } from "./config";
import { sanitizeName, uniqueName } from "./protocol";
import { randomHex } from "./random";
import {
  connectedIds, currentPhaseData, ensureHost, publicPlayer, publicRoom, removePlayer, reply, sendError,
  type Conn, type Ctx,
} from "./room";
import type { Avatar, ClientMessage, Player, RoomState, ServerMessage } from "./types";

// ---------------------------------------------------------------- messages

export function handleClientMessage(ctx: Ctx, conn: Conn, msg: ClientMessage): void {
  if (msg.type === "ping") {
    reply(ctx, { type: "pong", t: msg.t, serverTime: ctx.now });
    return;
  }
  if (msg.type === "join_room") {
    if (conn.playerId) return sendError(ctx, "INVALID_ACTION");
    join(ctx, msg.playerName, msg.avatar, msg.sessionToken);
    return;
  }
  const playerId = conn.playerId;
  if (!playerId || !ctx.state.players[playerId]) return sendError(ctx, "INVALID_ACTION");

  switch (msg.type) {
    case "update_avatar":
      return updateAvatar(ctx, playerId, msg.avatar);
    case "update_settings":
      return updateSettings(ctx, playerId, msg.cycles);
    case "leave_room":
      return leave(ctx, playerId);
    case "start_game":
    case "player_action":
    case "return_to_lobby":
      // GAME-FLOW: implemented in Task 5.
      return sendError(ctx, "INVALID_ACTION");
  }
}

// ---------------------------------------------------------------- lobby

function joinedMessage(s: RoomState, id: string): ServerMessage {
  return {
    type: "joined",
    player: { ...publicPlayer(s, id), sessionToken: s.players[id].sessionToken },
    room: publicRoom(s),
    phaseData: currentPhaseData(s),
  };
}

function join(ctx: Ctx, rawName: string, avatar: Avatar, sessionToken: string | undefined): void {
  const s = ctx.state;
  if (sessionToken) {
    const existing = Object.values(s.players).find((p) => p.sessionToken === sessionToken);
    if (existing) return reconnect(ctx, existing);
    if (s.phase !== "LOBBY") return sendError(ctx, "SESSION_EXPIRED");
  }
  if (s.phase !== "LOBBY") return sendError(ctx, "GAME_ALREADY_STARTED");
  const name = sanitizeName(rawName);
  if (!name) return sendError(ctx, "INVALID_NAME");
  if (s.order.length >= MAX_PLAYERS) return sendError(ctx, "ROOM_FULL");

  let id: string;
  do id = `p_${randomHex(ctx.random, 8)}`;
  while (s.players[id]);

  s.players[id] = {
    id,
    name: uniqueName(name, s.order.map((i) => s.players[i].name)),
    avatar,
    score: 0,
    connected: true,
    joinedAt: ctx.now,
    sessionToken: randomHex(ctx.random, 32),
    disconnectedAt: null,
  };
  s.order.push(id);
  s.emptySince = null;
  ensureHost(s);
  ctx.changed = true;
  ctx.effects.push({ kind: "bind", playerId: id });
  reply(ctx, joinedMessage(s, id));
}

function reconnect(ctx: Ctx, p: Player): void {
  const s = ctx.state;
  ctx.effects.push({ kind: "closePlayer", playerId: p.id });
  p.connected = true;
  p.disconnectedAt = null;
  s.emptySince = null;
  ensureHost(s);
  ctx.changed = true;
  ctx.effects.push({ kind: "bind", playerId: p.id });
  reply(ctx, joinedMessage(s, p.id));
}

function updateAvatar(ctx: Ctx, playerId: string, avatar: Avatar): void {
  if (ctx.state.phase !== "LOBBY") return sendError(ctx, "INVALID_PHASE");
  ctx.state.players[playerId].avatar = avatar;
  ctx.changed = true;
}

function updateSettings(ctx: Ctx, playerId: string, cycles: 1 | 2 | 3): void {
  const s = ctx.state;
  if (s.hostId !== playerId) return sendError(ctx, "NOT_HOST");
  if (s.phase !== "LOBBY") return sendError(ctx, "INVALID_PHASE");
  s.settings.cycles = cycles;
  ctx.changed = true;
}

function leave(ctx: Ctx, playerId: string): void {
  removePlayer(ctx.state, playerId);
  ctx.changed = true;
  ctx.effects.push({ kind: "closeCurrent" });
  afterPlayerGone(ctx, playerId);
}

// ---------------------------------------------------------------- disconnects

export function handleSocketClosed(ctx: Ctx, playerId: string): void {
  const p = ctx.state.players[playerId];
  if (!p || !p.connected) return;
  p.connected = false;
  p.disconnectedAt = ctx.now;
  ctx.changed = true;
  afterPlayerGone(ctx, playerId);
}

const inGame = (s: RoomState) => s.phase !== "LOBBY" && s.phase !== "GAME_RESULT";

/** Shared follow-up for a disconnect or a leave. `playerId` may already be removed. */
function afterPlayerGone(ctx: Ctx, playerId: string): void {
  const s = ctx.state;
  ensureHost(s);
  if (connectedIds(s).length === 0 && s.emptySince === null) s.emptySince = ctx.now;
  if (!inGame(s)) return;
  // GAME-FLOW: in-game consequences implemented in Task 5.
  void playerId;
}

// ---------------------------------------------------------------- alarms

export function handleAlarm(ctx: Ctx): void {
  const s = ctx.state;
  const now = ctx.now;
  if (s.emptySince !== null && now >= s.emptySince + EMPTY_ROOM_EXPIRE_MS) {
    ctx.effects.push({ kind: "wipe" });
    return;
  }
  if (s.phase === "LOBBY") {
    for (const id of [...s.order]) {
      const p = s.players[id];
      if (!p.connected && p.disconnectedAt !== null && now >= p.disconnectedAt + LOBBY_DISCONNECT_REMOVE_MS) {
        removePlayer(s, id);
        ctx.changed = true;
      }
    }
    ensureHost(s);
  }
  // GAME-FLOW: phase deadlines implemented in Task 5.
}

export function nextWakeTime(s: RoomState): number | null {
  const times: number[] = [];
  if (s.phaseEndsAt !== null) times.push(s.phaseEndsAt);
  if (s.emptySince !== null) times.push(s.emptySince + EMPTY_ROOM_EXPIRE_MS);
  if (s.phase === "LOBBY") {
    for (const id of s.order) {
      const p = s.players[id];
      if (!p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + LOBBY_DISCONNECT_REMOVE_MS);
    }
  }
  return times.length ? Math.min(...times) : null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: PASS (lobby, protocol, scoring, roomCode, random).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no errors outside `worker-configuration.d.ts`.

- [ ] **Step 8: Checkpoint**

All backend tests pass. No commit.
