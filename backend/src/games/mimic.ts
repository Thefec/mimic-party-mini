import { MIMIC_MS, PERFORM_MS } from "../config";
import { validateClip } from "../protocol";
import { broadcast, connectedIds, sendError, setPhase, type Ctx } from "../room";
import { scoreImitation } from "../scoring";
import type { RoomState } from "../types";
import type { MiniGame, RoundOutcome } from "./types";

export const PROMPTS = [
  "Kedi", "Siren", "Robot", "Kötü kahkaha", "Horoz", "Eski modem", "Araba kornası", "Hapşırık",
  "Opera sanatçısı", "Dinozor", "Kapı gıcırtısı", "Uzaylı", "Tavuk", "Kurt uluması", "Motor sesi",
  "Su damlası", "Yavru köpek", "Zombi", "Lazer silahı", "Keçi", "Tren düdüğü", "Ördek", "Esneme", "Balon patlaması",
];

function allMimicsDone(s: RoomState): boolean {
  const rs = s.roundState;
  return connectedIds(s).every((id) => id === rs.performerId || rs.submissions[id] !== undefined);
}

export const mimic: MiniGame = {
  id: "mimic",

  prepareRound(ctx) {
    ctx.state.roundState.prompt = PROMPTS[Math.floor(ctx.random() * PROMPTS.length)];
  },

  startRound(ctx) {
    setPhase(ctx, "PERFORM", PERFORM_MS);
  },

  handleAction(ctx: Ctx, playerId, action): RoundOutcome | null {
    if (action.type !== "submit_clip") {
      sendError(ctx, "INVALID_ACTION");
      return null;
    }
    const s = ctx.state;
    const rs = s.roundState;

    if (s.phase === "PERFORM") {
      if (playerId !== rs.performerId) {
        sendError(ctx, "INVALID_ACTION");
        return null;
      }
      const clip = validateClip(action);
      if (!clip) {
        sendError(ctx, "INVALID_MESSAGE");
        return null;
      }
      rs.original = clip;
      setPhase(ctx, "MIMIC", MIMIC_MS);
      return null;
    }

    // MIMIC
    if (playerId === rs.performerId) {
      sendError(ctx, "INVALID_ACTION");
      return null;
    }
    if (rs.submissions[playerId]) {
      sendError(ctx, "ALREADY_SUBMITTED");
      return null;
    }
    const clip = validateClip(action);
    if (!clip) {
      sendError(ctx, "INVALID_MESSAGE");
      return null;
    }
    const { score, breakdown } = scoreImitation(rs.original!.features, clip.features);
    rs.submissions[playerId] = { clip, score, breakdown };
    ctx.changed = true;
    broadcast(ctx, { type: "submission_received", playerId });
    return allMimicsDone(s) ? { skipped: false } : null;
  },

  onDeadline(ctx) {
    return { skipped: ctx.state.phase === "PERFORM" };
  },

  onPlayerDisconnected(ctx, playerId) {
    const s = ctx.state;
    if (s.phase === "PERFORM" && playerId === s.roundState.performerId) return { skipped: true };
    if (s.phase === "MIMIC" && allMimicsDone(s)) return { skipped: false };
    return null;
  },
};
