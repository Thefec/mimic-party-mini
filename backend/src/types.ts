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
