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
