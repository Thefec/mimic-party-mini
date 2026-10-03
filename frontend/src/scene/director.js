/**
 * Maps app state to the stage and labels. The app injects `levelFor(id, state)`,
 * which gives the 0..1 mouth level per character, and `text` for the bubbles.
 */
export function createDirector(stage, labels, { levelFor, text }) {
  let current = null;
  let jumpedRound = 0;
  let celebratedStandings = null;

  stage.onFrame(() => {
    if (!current?.room) return;
    for (const p of current.room.players) stage.characterOf(p.id)?.setTalk(levelFor(p.id, current));
  });

  function badgeFor(id, s) {
    const { phase } = s.room;
    if (phase === "MIMIC" && s.room.submitted.includes(id)) return "✔";
    if (phase === "ROUND_RESULT" && s.roundResult && !s.roundResult.skipped) {
      if (id === s.roundResult.performerId) return `+${s.roundResult.performerPoints}`;
      const r = s.roundResult.results.find((x) => x.playerId === id);
      if (r) return r.submitted ? `+${r.score}` : "—";
    }
    if (phase === "GAME_RESULT" && s.standings) {
      const st = s.standings.find((x) => x.playerId === id);
      if (st) return `#${st.rank}`;
    }
    return "";
  }

  function bubbleFor(id, s) {
    const { phase, performerId } = s.room;
    if (id !== performerId) return "";
    if (phase === "ROUND_INTRO" && s.phaseData?.prompt) return text.prompt(s.phaseData.prompt);
    if (phase === "PERFORM" && id !== s.self?.id) return text.recording;
    return "";
  }

  function sync(s) {
    current = s;
    const room = s.room;
    if (!room) {
      stage.syncPlayers([]);
      stage.setSpotlight(null);
      stage.focus(null);
      stage.setPodium(null);
      labels.sync([]);
      return;
    }
    stage.syncPlayers(room.players);

    const { phase, performerId } = room;
    const slot = room.players.findIndex((p) => p.id === performerId);
    const performing = slot >= 0 && ["ROUND_INTRO", "PERFORM", "MIMIC"].includes(phase);
    stage.setSpotlight(performing ? slot : null);
    stage.focus(slot >= 0 && (phase === "ROUND_INTRO" || phase === "PERFORM") ? slot : null);
    stage.setPodium(phase === "GAME_RESULT" && s.standings ? s.standings : null);

    for (const p of room.players) {
      labels.set(p.id, {
        name: p.name,
        host: p.id === room.hostId,
        sleeping: !p.connected,
        self: p.id === s.self?.id,
        badge: badgeFor(p.id, s),
        bubble: bubbleFor(p.id, s),
      });
    }
    labels.sync(room.players.map((p) => p.id));

    if (phase === "ROUND_RESULT" && s.roundResult && s.roundResult.round !== jumpedRound) {
      jumpedRound = s.roundResult.round;
      const best = s.roundResult.results.filter((r) => r.submitted).sort((a, b) => b.score - a.score)[0];
      if (best) stage.characterOf(best.playerId)?.jump(5);
    }

    const winners = phase === "GAME_RESULT" && s.standings ? s.standings.filter((x) => x.rank === 1).map((x) => x.playerId) : [];
    for (const p of room.players) stage.characterOf(p.id)?.setCelebrating(winners.includes(p.id));
    if (winners.length && s.standings !== celebratedStandings) {
      celebratedStandings = s.standings;
      stage.confetti();
    }
  }

  return { sync };
}
