# Task 2: Shared types, config, message validation

**Files:**
- Create: `backend/src/config.ts`, `backend/src/types.ts`, `backend/src/protocol.ts`
- Create: `backend/test/fixtures.ts`
- Test: `backend/test/protocol.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 3–6 and by frontend tests):
  - `config.ts`: `MAX_PLAYERS, MIN_PLAYERS, NAME_MAX_LENGTH, INTRO_MS, PERFORM_MS, MIMIC_MS, RESULT_MS, SKIPPED_RESULT_MS, LOBBY_DISCONNECT_REMOVE_MS, EMPTY_ROOM_EXPIRE_MS, MAX_MESSAGE_CHARS, MAX_WAV_BYTES, MAX_FRAMES, SAMPLE_RATE, AVATAR_LIMITS`
  - `types.ts`: `Phase, Avatar, Features, Clip, Breakdown, Player, Submission, MimicResult, RoundResult, Standing, RoundState, RoomState, PublicPlayer, PublicRoom, PhaseData, ErrorCode, ClientMessage, ServerMessage`
  - `protocol.ts`: `parseClientMessage(raw: unknown): ParseResult`, `sanitizeName(raw: unknown): string | null`, `uniqueName(name: string, taken: string[]): string`, `isValidAvatar(v: unknown): v is Avatar`, `validateClip(action: Record<string, unknown>): Clip | null`, `isValidWavBase64(b64: string): boolean`, `errorMessage(code: ErrorCode): ServerMessage`
  - `test/fixtures.ts`: `AVATAR`, `makeWavBase64(sampleCount?)`, `synth(frames, fns)`, `resampleFeatures(f, frames)`, `SIREN`, `CLAPS`, `HICCUPS`, `RISE`, `FALL`, `clip(features?)`

- [ ] **Step 1: Config and types**

`backend/src/config.ts`:
```ts
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const NAME_MAX_LENGTH = 16;

export const INTRO_MS = 3_000;
export const PERFORM_MS = 12_000;
export const MIMIC_MS = 20_000;
export const RESULT_MS = 12_000;
export const SKIPPED_RESULT_MS = 4_000;

export const LOBBY_DISCONNECT_REMOVE_MS = 60_000;
export const EMPTY_ROOM_EXPIRE_MS = 10 * 60_000;

export const MAX_MESSAGE_CHARS = 256 * 1024;
export const MAX_WAV_BYTES = 110 * 1024;
export const MAX_FRAMES = 80;
export const SAMPLE_RATE = 16_000;

export const AVATAR_LIMITS = { body: 4, color: 10, eyes: 4, hat: 6 } as const;
```

`backend/src/types.ts`:
```ts
export type Phase = "LOBBY" | "ROUND_INTRO" | "PERFORM" | "MIMIC" | "ROUND_RESULT" | "GAME_RESULT";

export interface Avatar { body: number; color: number; eyes: number; hat: number; }
export interface Features { energy: number[]; pitch: number[]; centroid: number[]; }
export interface Clip { audio: string; features: Features; }
export interface Breakdown { rhythm: number; pitch: number | null; tone: number; }

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  connected: boolean;
  joinedAt: number;
  sessionToken: string;
  disconnectedAt: number | null;
}

export interface Submission { clip: Clip; score: number; breakdown: Breakdown; }

export interface MimicResult {
  playerId: string;
  submitted: boolean;
  score: number;
  breakdown: Breakdown | null;
  clip: Clip | null;
}

export interface RoundResult {
  round: number;
  performerId: string;
  skipped: boolean;
  original: Clip | null;
  results: MimicResult[];
  performerPoints: number;
}

export interface Standing { playerId: string; name: string; score: number; rank: number; }

export interface RoundState {
  performerId: string | null;
  prompt: string | null;
  original: Clip | null;
  submissions: Record<string, Submission>;
  result: RoundResult | null;
}

export interface RoomState {
  id: string;
  hostId: string | null;
  phase: Phase;
  phaseEndsAt: number | null;
  settings: { cycles: 1 | 2 | 3 };
  round: number;
  totalRounds: number;
  players: Record<string, Player>;
  order: string[];
  performerQueue: string[];
  roundState: RoundState;
  standings: Standing[] | null;
  emptySince: number | null;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  isHost: boolean;
  connected: boolean;
}

export interface PublicRoom {
  id: string;
  hostId: string | null;
  phase: Phase;
  phaseEndsAt: number | null;
  settings: { cycles: 1 | 2 | 3 };
  round: number;
  totalRounds: number;
  players: PublicPlayer[];
  performerId: string | null;
  submitted: string[];
}

export type PhaseData =
  | { performerId: string; prompt: string }              // ROUND_INTRO, PERFORM
  | { performerId: string; clip: Clip }                  // MIMIC
  | RoundResult                                          // ROUND_RESULT (joined only)
  | { standings: Standing[] }                            // GAME_RESULT (joined only)
  | null;

export type ErrorCode =
  | "ROOM_NOT_FOUND" | "ROOM_FULL" | "INVALID_NAME" | "INVALID_MESSAGE" | "INVALID_ACTION"
  | "NOT_HOST" | "NOT_ENOUGH_PLAYERS" | "GAME_ALREADY_STARTED" | "INVALID_PHASE"
  | "ALREADY_SUBMITTED" | "RATE_LIMITED" | "SESSION_EXPIRED";

export type ClientMessage =
  | { type: "join_room"; playerName: string; avatar: Avatar; sessionToken?: string }
  | { type: "update_avatar"; avatar: Avatar }
  | { type: "update_settings"; cycles: 1 | 2 | 3 }
  | { type: "start_game" }
  | { type: "player_action"; action: Record<string, unknown> & { type: string } }
  | { type: "return_to_lobby" }
  | { type: "leave_room" }
  | { type: "ping"; t: number };

export type ServerMessage =
  | { type: "joined"; player: PublicPlayer & { sessionToken: string }; room: PublicRoom; phaseData: PhaseData }
  | { type: "room_state"; room: PublicRoom }
  | { type: "phase_changed"; phase: Phase; round: number; endsAt: number | null; data: PhaseData }
  | { type: "submission_received"; playerId: string }
  | ({ type: "round_result" } & RoundResult)
  | { type: "game_result"; standings: Standing[] }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "pong"; t: number; serverTime: number };
```

Note the one refinement over the spec's §6.2: `PERFORM` phase data also carries `prompt`, so the performer still sees the suggestion while recording.

- [ ] **Step 2: Test fixtures**

`backend/test/fixtures.ts`:
```ts
import type { Avatar, Clip, Features } from "../src/types";

export const AVATAR: Avatar = { body: 0, color: 0, eyes: 0, hat: 0 };

/** Canonical 44-byte-header 16 kHz mono PCM16 WAV (silence), base64. */
export function makeWavBase64(sampleCount = 1600): string {
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const str = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i); };
  str(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); str(8, "WAVE");
  str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, sampleCount * 2, true);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

type Fn = (x: number) => number;

/** Build a feature sequence by sampling functions of x ∈ [0, 1]. */
export function synth(frames: number, fns: { energy: Fn; pitch: Fn; centroid: Fn }): Features {
  const xs = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : i / (frames - 1)));
  return { energy: xs.map(fns.energy), pitch: xs.map(fns.pitch), centroid: xs.map(fns.centroid) };
}

/** Linear time-stretch of every feature array to `frames` frames. */
export function resampleFeatures(f: Features, frames: number): Features {
  const stretch = (arr: number[]) =>
    Array.from({ length: frames }, (_, i) => {
      const pos = (i / (frames - 1)) * (arr.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(arr.length - 1, lo + 1);
      return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
    });
  return { energy: stretch(f.energy), pitch: stretch(f.pitch), centroid: stretch(f.centroid) };
}

const TAU = Math.PI * 2;

/** Voiced "wee-oo-wee-oo" with steady loudness. */
export const SIREN = synth(60, {
  energy: () => -12,
  pitch: (x) => 300 * 2 ** (0.5 * Math.sin(TAU * 2 * x)),
  centroid: (x) => 1500 + 500 * Math.sin(TAU * 2 * x),
});

/** Four unvoiced claps. */
export const CLAPS = synth(60, {
  energy: (x) => ((x * 4) % 1 < 0.2 ? -8 : -70),
  pitch: () => 0,
  centroid: (x) => ((x * 4) % 1 < 0.2 ? 3000 : 0),
});

/** Three short voiced hiccups with silence in between. */
export const HICCUPS = synth(60, {
  energy: (x) => ((x * 3) % 1 < 0.3 ? -10 : -70),
  pitch: (x) => ((x * 3) % 1 < 0.3 ? 600 : 0),
  centroid: (x) => ((x * 3) % 1 < 0.3 ? 2500 : 0),
});

/** Crescendo with rising pitch. */
export const RISE = synth(60, {
  energy: (x) => -40 + 35 * x,
  pitch: (x) => 200 * 2 ** x,
  centroid: (x) => 800 + 1200 * x,
});

/** Decrescendo with falling pitch. */
export const FALL = synth(60, {
  energy: (x) => -5 - 35 * x,
  pitch: (x) => 400 * 2 ** -x,
  centroid: (x) => 2000 - 1200 * x,
});

export function clip(features: Features = SIREN): Clip {
  return { audio: makeWavBase64(), features };
}
```

- [ ] **Step 3: Write failing tests**

`backend/test/protocol.test.ts`:
```ts
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
    expect(sanitizeName("A‮lex​")).toBe("Alex");
    expect(sanitizeName("Bob\u0000")).toBe("Bob");
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -w backend`
Expected: FAIL — cannot resolve `../src/protocol`.

- [ ] **Step 5: Implement `protocol.ts`**

`backend/src/protocol.ts`:
```ts
import { AVATAR_LIMITS, MAX_FRAMES, MAX_MESSAGE_CHARS, MAX_WAV_BYTES, NAME_MAX_LENGTH, SAMPLE_RATE } from "./config";
import type { Avatar, ClientMessage, Clip, ErrorCode, Features, ServerMessage } from "./types";

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; error: ErrorCode | null };

const INVALID: ParseResult = { ok: false, error: "INVALID_MESSAGE" };
const IGNORE: ParseResult = { ok: false, error: null };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// C0/C1 controls, zero-width chars, bidi embeddings/overrides/isolates.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏ -‮⁠-⁤⁦-⁩﻿]/g;

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  const length = Array.from(cleaned).length;
  if (length < 1 || length > NAME_MAX_LENGTH) return null;
  return cleaned;
}

export function uniqueName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLocaleLowerCase("tr")));
  if (!lower.has(name.toLocaleLowerCase("tr"))) return name;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const base = Array.from(name).slice(0, NAME_MAX_LENGTH - suffix.length).join("").trimEnd();
    const candidate = base + suffix;
    if (!lower.has(candidate.toLocaleLowerCase("tr"))) return candidate;
  }
}

const AVATAR_KEYS = Object.keys(AVATAR_LIMITS) as (keyof typeof AVATAR_LIMITS)[];

export function isValidAvatar(v: unknown): v is Avatar {
  if (!isObj(v) || Object.keys(v).length !== AVATAR_KEYS.length) return false;
  return AVATAR_KEYS.every((k) => {
    const n = v[k];
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < AVATAR_LIMITS[k];
  });
}

const pickAvatar = (a: Avatar): Avatar => ({ body: a.body, color: a.color, eyes: a.eyes, hat: a.hat });

export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_CHARS) return INVALID;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return INVALID;
  }
  if (!isObj(data) || typeof data.type !== "string") return INVALID;

  switch (data.type) {
    case "join_room": {
      const { playerName, avatar, sessionToken } = data;
      if (typeof playerName !== "string" || !isValidAvatar(avatar)) return INVALID;
      if (sessionToken !== undefined && (typeof sessionToken !== "string" || !/^[0-9a-f]{32}$/.test(sessionToken))) return INVALID;
      return { ok: true, msg: { type: "join_room", playerName, avatar: pickAvatar(avatar), sessionToken } };
    }
    case "update_avatar":
      return isValidAvatar(data.avatar) ? { ok: true, msg: { type: "update_avatar", avatar: pickAvatar(data.avatar) } } : INVALID;
    case "update_settings":
      return data.cycles === 1 || data.cycles === 2 || data.cycles === 3
        ? { ok: true, msg: { type: "update_settings", cycles: data.cycles } }
        : INVALID;
    case "player_action": {
      const action = data.action;
      if (!isObj(action) || typeof action.type !== "string") return INVALID;
      return { ok: true, msg: { type: "player_action", action: action as Record<string, unknown> & { type: string } } };
    }
    case "ping":
      return typeof data.t === "number" && Number.isFinite(data.t) ? { ok: true, msg: { type: "ping", t: data.t } } : INVALID;
    case "start_game":
    case "return_to_lobby":
    case "leave_room":
      return { ok: true, msg: { type: data.type } };
    default:
      return IGNORE;
  }
}

function isValidFeatures(f: unknown): f is Features {
  if (!isObj(f)) return false;
  const { energy, pitch, centroid } = f;
  if (!Array.isArray(energy) || !Array.isArray(pitch) || !Array.isArray(centroid)) return false;
  const n = energy.length;
  if (n < 1 || n > MAX_FRAMES || pitch.length !== n || centroid.length !== n) return false;
  for (let i = 0; i < n; i++) {
    const e = energy[i], p = pitch[i], c = centroid[i];
    if (typeof e !== "number" || !Number.isFinite(e) || e < -120 || e > 0) return false;
    if (typeof p !== "number" || !Number.isFinite(p) || (p !== 0 && (p < 50 || p > 1200))) return false;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 8000) return false;
  }
  return true;
}

export function isValidWavBase64(b64: string): boolean {
  if (b64.length > Math.ceil(MAX_WAV_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return false;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return false;
  }
  if (bin.length < 44 || bin.length > MAX_WAV_BYTES) return false;
  const u16 = (o: number) => bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8);
  const u32 = (o: number) => (u16(o) | (u16(o + 2) << 16)) >>> 0;
  return (
    bin.slice(0, 4) === "RIFF" &&
    bin.slice(8, 12) === "WAVE" &&
    bin.slice(12, 16) === "fmt " &&
    u16(20) === 1 && // PCM
    u16(22) === 1 && // mono
    u32(24) === SAMPLE_RATE &&
    u16(34) === 16 &&
    bin.slice(36, 40) === "data" &&
    u32(40) === bin.length - 44
  );
}

export function validateClip(action: Record<string, unknown>): Clip | null {
  const { audio, features } = action;
  if (typeof audio !== "string" || !isValidFeatures(features) || !isValidWavBase64(audio)) return null;
  return {
    audio,
    features: { energy: [...features.energy], pitch: [...features.pitch], centroid: [...features.centroid] },
  };
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: "Room not found.",
  ROOM_FULL: "This room is full.",
  INVALID_NAME: "Name must be 1-16 characters.",
  INVALID_MESSAGE: "Invalid message.",
  INVALID_ACTION: "That action is not allowed right now.",
  NOT_HOST: "Only the host can do that.",
  NOT_ENOUGH_PLAYERS: "At least 2 players are needed.",
  GAME_ALREADY_STARTED: "The game has already started.",
  INVALID_PHASE: "Too late for that.",
  ALREADY_SUBMITTED: "Already submitted.",
  RATE_LIMITED: "Slow down.",
  SESSION_EXPIRED: "Your session has expired.",
};

export function errorMessage(code: ErrorCode): ServerMessage {
  return { type: "error", code, message: ERROR_TEXT[code] };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: PASS. If the `"abcdefghijklmn 2"` case fails, check that `uniqueName` slices to `16 - 2 = 14` code points before adding `" 2"`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no errors in `src/config.ts`, `src/types.ts`, `src/protocol.ts` or the tests. Errors in `worker-configuration.d.ts` about the missing `GameRoom` class are expected until Task 6.

- [ ] **Step 8: Checkpoint**

All backend tests pass. No commit.
