import { createDirector } from "../src/scene/director.js";
import { Labels } from "../src/scene/labels.js";
import { Stage } from "../src/scene/stage.js";
import { randomAvatar } from "../src/scene/avatarOptions.js";
import { h } from "../src/ui/dom.js";

const stage = new Stage(document.getElementById("stage"));
stage.start();
const labels = new Labels(document.getElementById("labels"), stage);

const talkingUntil = new Map();
const director = createDirector(stage, labels, {
  levelFor: (id) => ((talkingUntil.get(id) ?? 0) > performance.now() ? 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 90)) : 0),
  text: { recording: "🎙️ kaydediyor…", prompt: (p) => `“${p}”` },
});

const NAMES = ["Batu", "Ayşe", "Mehmet", "Zeynep", "Can", "Elif"];
let nextId = 0;
const s = {
  self: { id: "p0" },
  room: { id: "PROTO", hostId: "p0", phase: "LOBBY", round: 1, totalRounds: 6, phaseEndsAt: null, settings: { cycles: 1 }, players: [], performerId: null, submitted: [] },
  phaseData: null,
  roundResult: null,
  standings: null,
};
const sync = () => director.sync(s);
const addPlayer = () => {
  if (s.room.players.length >= 6) return;
  const id = `p${nextId++}`;
  s.room.players.push({ id, name: NAMES[s.room.players.length], avatar: randomAvatar(), score: 0, isHost: id === "p0", connected: true });
  sync();
};
const setPhase = (phase) => {
  const players = s.room.players;
  s.room.phase = phase;
  s.room.performerId = players[0]?.id ?? null;
  s.phaseData = { performerId: s.room.performerId, prompt: "Robot" };
  s.room.submitted = phase === "MIMIC" ? players.slice(1, 3).map((p) => p.id) : [];
  s.roundResult = phase === "ROUND_RESULT"
    ? { round: Math.random(), performerId: s.room.performerId, skipped: false, performerPoints: 40, original: null,
        results: players.slice(1).map((p) => ({ playerId: p.id, submitted: true, score: Math.floor(Math.random() * 100), breakdown: null, clip: null })) }
    : null;
  s.standings = phase === "GAME_RESULT"
    ? players.map((p) => ({ playerId: p.id, name: p.name, score: Math.floor(Math.random() * 500) }))
        .sort((a, b) => b.score - a.score).map((x, i) => ({ ...x, rank: i + 1 }))
    : null;
  sync();
};

const controls = document.getElementById("controls");
const button = (label, fn) => controls.append(h("button", { onclick: fn }, label));
button("+ oyuncu", addPlayer);
button("− oyuncu", () => { s.room.players.pop(); sync(); });
button("🎲 avatarlar", () => { s.room.players = s.room.players.map((p) => ({ ...p, avatar: randomAvatar() })); sync(); });
button("💤 son oyuncu", () => { const p = s.room.players.at(-1); if (p) p.connected = !p.connected; sync(); });
button("🗣️ performer konuşsun", () => { const id = s.room.players[0]?.id; if (id) talkingUntil.set(id, performance.now() + 2000); });
button("🗣️ herkes konuşsun", () => { for (const p of s.room.players) talkingUntil.set(p.id, performance.now() + 2000); });
button("🦘 zıpla", () => { for (const p of s.room.players) stage.characterOf(p.id)?.jump(4); });
for (const phase of ["LOBBY", "ROUND_INTRO", "PERFORM", "MIMIC", "ROUND_RESULT", "GAME_RESULT"]) button(phase, () => setPhase(phase));

for (let i = 0; i < 4; i++) addPlayer();
