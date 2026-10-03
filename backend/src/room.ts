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
