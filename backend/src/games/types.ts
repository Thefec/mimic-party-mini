import type { Ctx } from "../room";

/** Returned by a mini-game when the current round is over. Round data lives in ctx.state.roundState. */
export interface RoundOutcome { skipped: boolean; }

export interface MiniGame {
  id: string;
  /** Called when a round is set up, before ROUND_INTRO. Fill roundState.prompt etc. */
  prepareRound(ctx: Ctx): void;
  /** ROUND_INTRO is over: enter the game's first phase. */
  startRound(ctx: Ctx): void;
  handleAction(ctx: Ctx, playerId: string, action: Record<string, unknown> & { type: string }): RoundOutcome | null;
  /** The current game-owned phase hit its deadline. */
  onDeadline(ctx: Ctx): RoundOutcome | null;
  /** A player disconnected or left during a game-owned phase (may already be removed from state). */
  onPlayerDisconnected(ctx: Ctx, playerId: string): RoundOutcome | null;
}
