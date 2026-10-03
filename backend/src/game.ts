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
      return startGame(ctx, playerId);
    case "player_action":
      return playerAction(ctx, playerId, msg.action);
    case "return_to_lobby":
      return returnToLobby(ctx, playerId);
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
  if (connectedIds(s).length < MIN_PLAYERS) return endGame(ctx);
  if (s.phase === "ROUND_INTRO" && s.roundState.performerId === playerId) return finishRound(ctx, { skipped: true });
  if (s.phase === "PERFORM" || s.phase === "MIMIC") {
    const outcome = activeGame().onPlayerDisconnected(ctx, playerId);
    if (outcome) finishRound(ctx, outcome);
  }
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
