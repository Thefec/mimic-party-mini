import { describe, expect, it } from "vitest";
import {
  errorMessage, isValidAvatar, isValidWavBase64, parseClientMessage, sanitizeName, uniqueName, validateClip,
} from "../src/protocol";
import { AVATAR, makeWavBase64, SIREN } from "./fixtures";

const ok = (raw: unknown) => {
  const r = parseClientMessage(raw);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.msg;
};
const err = (raw: unknown) => {
  const r = parseClientMessage(raw);
  if (r.ok) throw new Error("expected error");
  return r.error;
};

describe("parseClientMessage", () => {
  it("rejects non-strings, oversized input and malformed JSON", () => {
    expect(err(42)).toBe("INVALID_MESSAGE");
    expect(err("x".repeat(256 * 1024 + 1))).toBe("INVALID_MESSAGE");
    expect(err("{not json")).toBe("INVALID_MESSAGE");
    expect(err("[]")).toBe("INVALID_MESSAGE");
    expect(err(JSON.stringify({ noType: 1 }))).toBe("INVALID_MESSAGE");
  });

  it("silently ignores unknown message types", () => {
    expect(err(JSON.stringify({ type: "dance" }))).toBeNull();
  });

  it("parses join_room with and without a session token", () => {
    expect(ok(JSON.stringify({ type: "join_room", playerName: "Alex", avatar: AVATAR }))).toEqual({
      type: "join_room", playerName: "Alex", avatar: AVATAR, sessionToken: undefined,
    });
    const token = "a".repeat(32);
    expect(ok(JSON.stringify({ type: "join_room", playerName: "Alex", avatar: AVATAR, sessionToken: token }))).toMatchObject({ sessionToken: token });
  });

  it("rejects join_room with a bad avatar or token", () => {
    expect(err(JSON.stringify({ type: "join_room", playerName: "A", avatar: { ...AVATAR, hat: 6 } }))).toBe("INVALID_MESSAGE");
    expect(err(JSON.stringify({ type: "join_room", playerName: "A", avatar: AVATAR, sessionToken: "short" }))).toBe("INVALID_MESSAGE");
    expect(err(JSON.stringify({ type: "join_room", playerName: 5, avatar: AVATAR }))).toBe("INVALID_MESSAGE");
  });

  it("parses the simple messages", () => {
    expect(ok('{"type":"start_game"}')).toEqual({ type: "start_game" });
    expect(ok('{"type":"return_to_lobby"}')).toEqual({ type: "return_to_lobby" });
    expect(ok('{"type":"leave_room"}')).toEqual({ type: "leave_room" });
    expect(ok('{"type":"ping","t":123}')).toEqual({ type: "ping", t: 123 });
    expect(err('{"type":"ping","t":"x"}')).toBe("INVALID_MESSAGE");
  });

  it("validates update_settings and update_avatar", () => {
    expect(ok('{"type":"update_settings","cycles":2}')).toEqual({ type: "update_settings", cycles: 2 });
    expect(err('{"type":"update_settings","cycles":4}')).toBe("INVALID_MESSAGE");
    expect(ok(JSON.stringify({ type: "update_avatar", avatar: AVATAR }))).toEqual({ type: "update_avatar", avatar: AVATAR });
    expect(err(JSON.stringify({ type: "update_avatar", avatar: { ...AVATAR, extra: 1 } }))).toBe("INVALID_MESSAGE");
  });

  it("requires player_action.action to be an object with a string type", () => {
    expect(ok(JSON.stringify({ type: "player_action", action: { type: "submit_clip", audio: "x" } }))).toMatchObject({ type: "player_action" });
    expect(err(JSON.stringify({ type: "player_action", action: "submit" }))).toBe("INVALID_MESSAGE");
    expect(err(JSON.stringify({ type: "player_action", action: { kind: "x" } }))).toBe("INVALID_MESSAGE");
  });
});

describe("names", () => {
  it("trims, collapses whitespace and strips control / bidi / zero-width characters", () => {
    expect(sanitizeName("  Al   ex  ")).toBe("Al ex");
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const lineSep = String.fromCharCode(0x2028);
    expect(sanitizeName(`A${rlo}lex${zwsp}`)).toBe("Alex");
    expect(sanitizeName(`Bo${lineSep}b${String.fromCharCode(0)}`)).toBe("Bob");
  });

  it("keeps HTML as plain text (rendering is the client's job) but enforces length", () => {
    expect(sanitizeName("<b>x</b>")).toBe("<b>x</b>");
    expect(sanitizeName("")).toBeNull();
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName("x".repeat(17))).toBeNull();
    expect(sanitizeName("😀".repeat(16))).toBe("😀".repeat(16));
    expect(sanitizeName(42)).toBeNull();
  });

  it("uniqueName appends a numeric suffix case-insensitively", () => {
    expect(uniqueName("Alex", [])).toBe("Alex");
    expect(uniqueName("alex", ["Alex"])).toBe("alex 2");
    expect(uniqueName("Alex", ["Alex", "Alex 2"])).toBe("Alex 3");
    expect(uniqueName("abcdefghijklmnop", ["abcdefghijklmnop"])).toBe("abcdefghijklmn 2");
  });
});

describe("avatars", () => {
  it("accepts exactly the four integer fields within range", () => {
    expect(isValidAvatar({ body: 3, color: 9, eyes: 3, hat: 5 })).toBe(true);
    expect(isValidAvatar({ body: 4, color: 0, eyes: 0, hat: 0 })).toBe(false);
    expect(isValidAvatar({ body: 0, color: -1, eyes: 0, hat: 0 })).toBe(false);
    expect(isValidAvatar({ body: 0.5, color: 0, eyes: 0, hat: 0 })).toBe(false);
    expect(isValidAvatar({ body: 0, color: 0, eyes: 0 })).toBe(false);
    expect(isValidAvatar(null)).toBe(false);
  });
});

describe("clips", () => {
  const good = { type: "submit_clip", audio: makeWavBase64(), features: SIREN };

  it("accepts a canonical WAV with matching features", () => {
    expect(isValidWavBase64(makeWavBase64())).toBe(true);
    expect(validateClip(good)).toEqual({ audio: good.audio, features: SIREN });
  });

  it("rejects non-WAV, wrong sample rate and oversized audio", () => {
    expect(isValidWavBase64(btoa("hello world"))).toBe(false);
    expect(isValidWavBase64("!!!")).toBe(false);
    const wrongRate = atob(makeWavBase64());
    const patched = wrongRate.slice(0, 24) + String.fromCharCode(0x44, 0xac, 0, 0) + wrongRate.slice(28); // 44100
    expect(isValidWavBase64(btoa(patched))).toBe(false);
    expect(isValidWavBase64(makeWavBase64(60_000))).toBe(false); // 120 KB > 110 KB
  });

  it("rejects bad feature arrays", () => {
    const bad = (features: unknown) => validateClip({ ...good, features });
    expect(bad({ ...SIREN, pitch: SIREN.pitch.slice(1) })).toBeNull();
    expect(bad({ energy: [], pitch: [], centroid: [] })).toBeNull();
    expect(bad({ energy: Array(81).fill(-10), pitch: Array(81).fill(0), centroid: Array(81).fill(0) })).toBeNull();
    expect(bad({ ...SIREN, energy: [5, ...SIREN.energy.slice(1)] })).toBeNull();
    expect(bad({ ...SIREN, pitch: [30, ...SIREN.pitch.slice(1)] })).toBeNull();
    expect(bad({ ...SIREN, centroid: [NaN, ...SIREN.centroid.slice(1)] })).toBeNull();
    expect(validateClip({ type: "submit_clip", audio: 5, features: SIREN })).toBeNull();
  });
});

describe("errorMessage", () => {
  it("builds an error message with a human-readable text", () => {
    const m = errorMessage("ROOM_FULL");
    expect(m).toMatchObject({ type: "error", code: "ROOM_FULL" });
    expect(m.type === "error" && m.message.length > 0).toBe(true);
  });
});
