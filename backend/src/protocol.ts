import { AVATAR_LIMITS, MAX_FRAMES, MAX_MESSAGE_CHARS, MAX_WAV_BYTES, NAME_MAX_LENGTH, SAMPLE_RATE } from "./config";
import type { Avatar, ClientMessage, Clip, ErrorCode, Features, ServerMessage } from "./types";

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; error: ErrorCode | null };

const INVALID: ParseResult = { ok: false, error: "INVALID_MESSAGE" };
const IGNORE: ParseResult = { ok: false, error: null };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// C0/C1 controls, zero-width chars, bidi embeddings/overrides/isolates.
// Built from code points so no invisible characters live in the source file.
const UNSAFE_RANGES: [number, number][] = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff],
];
const hex = (n: number) => "\\u" + n.toString(16).padStart(4, "0");
const UNSAFE_CHARS = new RegExp(`[${UNSAFE_RANGES.map(([a, b]) => `${hex(a)}-${hex(b)}`).join("")}]`, "g");

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
