// End-to-end check against a running `npm run dev` (or SERVER=https://... for production).
const BASE = (process.env.SERVER ?? "http://localhost:8787").replace(/\/+$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

function wav(n = 16000) {
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), 44 + i * 2);
  return b.toString("base64");
}
const features = {
  energy: Array(25).fill(-12),
  pitch: Array.from({ length: 25 }, (_, i) => 300 + i * 4),
  centroid: Array(25).fill(1500),
};
const clipAction = { type: "submit_clip", audio: wav(), features };
const avatar = { body: 0, color: 1, eyes: 2, hat: 3 };

function connect(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/api/rooms/${roomId}/ws`);
    const inbox = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      inbox.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    };
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onopen = () =>
      resolve({
        ws,
        send: (m) => ws.send(JSON.stringify(m)),
        waitFor: (pred, label, ms = 20_000) =>
          new Promise((res, rej) => {
            const hit = inbox.find(pred);
            if (hit) return res(hit);
            waiters.push({ pred, resolve: res });
            setTimeout(() => rej(new Error(`timeout waiting for ${label}`)), ms);
          }),
      });
  });
}

const check = (cond, label) => { if (!cond) throw new Error(`FAILED: ${label}`); console.log(`ok - ${label}`); };

const pre = await fetch(`${BASE}/api/rooms`, { method: "OPTIONS" });
check(pre.status === 204 && pre.headers.get("access-control-allow-origin") === "*", "CORS preflight");

const res = await fetch(`${BASE}/api/rooms`, { method: "POST" });
const { roomId } = await res.json();
check(/^[A-Z2-9]{5}$/.test(roomId), `room created (${roomId})`);

const ghost = await connect("ZZZZZ");
const notFound = await ghost.waitFor((m) => m.type === "error", "ROOM_NOT_FOUND");
check(notFound.code === "ROOM_NOT_FOUND", "unknown room is rejected");

const a = await connect(roomId);
a.send({ type: "join_room", playerName: "Smoke A", avatar });
const joinedA = await a.waitFor((m) => m.type === "joined", "A joined");
check(joinedA.player.isHost, "first player is host");

const b = await connect(roomId);
b.send({ type: "join_room", playerName: "Smoke B", avatar });
await b.waitFor((m) => m.type === "joined", "B joined");
await a.waitFor((m) => m.type === "room_state" && m.room.players.length === 2, "A sees B");
check(true, "both players see each other");

a.send({ type: "start_game" });
await a.waitFor((m) => m.type === "phase_changed" && m.phase === "PERFORM", "PERFORM (after 3 s alarm)");
check(true, "alarm moved ROUND_INTRO -> PERFORM");

a.send({ type: "player_action", action: clipAction });
const mimic = await b.waitFor((m) => m.type === "phase_changed" && m.phase === "MIMIC", "MIMIC");
check(mimic.data.clip.audio === clipAction.audio, "mimic received the original clip");

b.send({ type: "player_action", action: clipAction });
const result = await a.waitFor((m) => m.type === "round_result", "round_result");
check(result.results[0].score === 100, "identical imitation scores 100");

a.send({ type: "ping", t: 1 });
const pong = await a.waitFor((m) => m.type === "pong", "pong");
check(pong.t === 1 && typeof pong.serverTime === "number", "ping/pong");

a.ws.close(); b.ws.close(); ghost.ws.close();
console.log("SMOKE PASSED");
process.exit(0);
