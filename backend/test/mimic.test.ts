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
