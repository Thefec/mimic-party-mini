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
