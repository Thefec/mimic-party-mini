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
