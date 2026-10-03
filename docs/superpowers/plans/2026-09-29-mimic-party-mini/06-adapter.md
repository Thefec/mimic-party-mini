# Task 6: Durable Object adapter, Worker entry, rate limit, smoke test

**Files:**
- Create: `backend/src/rateLimit.ts`, `backend/src/GameRoom.ts`, `backend/src/index.ts`
- Create: `backend/scripts/smoke.mjs`
- Test: `backend/test/rateLimit.test.ts`
- Regenerate: `backend/worker-configuration.d.ts`

**Interfaces:**
- Consumes: `handleClientMessage`, `handleSocketClosed`, `handleAlarm`, `nextWakeTime` (Tasks 4–5); `createRoomState`, `publicRoom`, `Ctx`, `Effect` (Task 4); `parseClientMessage`, `errorMessage` (Task 2); `generateRoomCode`, `cryptoRandom` (Task 1).
- Produces:
  - HTTP `POST /api/rooms` → `200 {"roomId":"A7K2P"}` with CORS `*` (and `OPTIONS` preflight → 204).
  - WS `GET /api/rooms/:code/ws`. For an unknown room it sends `{"type":"error","code":"ROOM_NOT_FOUND",…}` and closes with code `4404`.
  - Close codes the client relies on (Task 9):
    - `1000` — the player left
    - `4000` — replaced by a newer socket for the same player
    - `4404` — room not found
    - `4429` — rate-limited too often
  - `TokenBucket(rate = 10, burst = 20, now?)` with `take(now?) → boolean` and a `dropped` counter; `MAX_DROPPED = 100`.

- [ ] **Step 1: Write failing rate limit test**

`backend/test/rateLimit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/rateLimit";

describe("TokenBucket", () => {
  it("allows a burst of 20, then refills at 10/s", () => {
    const b = new TokenBucket(10, 20, 0);
    for (let i = 0; i < 20; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.dropped).toBe(1);
    expect(b.take(100)).toBe(true); // 0.1 s -> 1 token
    expect(b.take(100)).toBe(false);
    expect(b.dropped).toBe(2);
  });

  it("never exceeds the burst size", () => {
    const b = new TokenBucket(10, 20, 0);
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (b.take(60_000)) allowed++;
    expect(allowed).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w backend -- rateLimit`
Expected: FAIL — cannot resolve `../src/rateLimit`.

- [ ] **Step 3: Implement `rateLimit.ts`**

`backend/src/rateLimit.ts`:
```ts
/** Close a socket after this many rejected messages. */
export const MAX_DROPPED = 100;

export class TokenBucket {
  private tokens: number;
  private last: number;
  dropped = 0;

  constructor(private readonly rate = 10, private readonly burst = 20, now = Date.now()) {
    this.tokens = burst;
    this.last = now;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.dropped++;
    return false;
  }
}
```

Run: `npm test -w backend -- rateLimit` → PASS.

- [ ] **Step 4: Implement the Durable Object**

`backend/src/GameRoom.ts`:
```ts
import { DurableObject } from "cloudflare:workers";
import { handleAlarm, handleClientMessage, handleSocketClosed, nextWakeTime } from "./game";
import { errorMessage, parseClientMessage } from "./protocol";
import { cryptoRandom } from "./random";
import { MAX_DROPPED, TokenBucket } from "./rateLimit";
import { createRoomState, publicRoom, type Ctx, type Effect } from "./room";
import type { RoomState, ServerMessage } from "./types";

interface Attachment { playerId: string | null; }

const STATE_KEY = "state";
const CLOSE_LEFT = 1000;
const CLOSE_REPLACED = 4000;
const CLOSE_NOT_FOUND = 4404;
const CLOSE_RATE_LIMITED = 4429;

export class GameRoom extends DurableObject<Env> {
  /** undefined = not loaded from storage yet; null = room does not exist (never created or wiped). */
  private room: RoomState | null | undefined = undefined;
  private buckets = new WeakMap<WebSocket, TokenBucket>();

  private async load(): Promise<RoomState | null> {
    if (this.room === undefined) this.room = (await this.ctx.storage.get<RoomState>(STATE_KEY)) ?? null;
    return this.room;
  }

  /** RPC from the Worker. Returns false if this code is already taken. */
  async init(roomId: string): Promise<boolean> {
    if (await this.load()) return false;
    const room = createRoomState(roomId);
    room.emptySince = Date.now(); // expires if nobody ever joins
    this.room = room;
    await this.ctx.storage.put(STATE_KEY, room);
    await this.scheduleAlarm();
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    if (!(await this.load())) {
      this.sendTo(server, errorMessage("ROOM_NOT_FOUND"));
      server.close(CLOSE_NOT_FOUND, "room not found");
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let bucket = this.buckets.get(ws);
    if (!bucket) this.buckets.set(ws, (bucket = new TokenBucket()));
    if (!bucket.take()) {
      if (bucket.dropped > MAX_DROPPED) ws.close(CLOSE_RATE_LIMITED, "rate limited");
      else this.sendTo(ws, errorMessage("RATE_LIMITED"));
      return;
    }
    if (!(await this.load())) {
      this.sendTo(ws, errorMessage("ROOM_NOT_FOUND"));
      ws.close(CLOSE_NOT_FOUND, "room not found");
      return;
    }
    const parsed = parseClientMessage(typeof raw === "string" ? raw : null);
    if (!parsed.ok) {
      if (parsed.error) this.sendTo(ws, errorMessage(parsed.error));
      return;
    }
    const { playerId } = ws.deserializeAttachment() as Attachment;
    await this.run(ws, (ctx) => handleClientMessage(ctx, { playerId }, parsed.msg));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code, reason); } catch { /* already closed */ }
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async alarm(): Promise<void> {
    if (!(await this.load())) return;
    await this.run(null, (ctx) => handleAlarm(ctx));
  }

  // ------------------------------------------------------------ internals

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att?.playerId) return; // never joined, left, or replaced
    ws.serializeAttachment({ playerId: null } satisfies Attachment);
    if (!(await this.load())) return;
    const playerId = att.playerId;
    await this.run(null, (ctx) => handleSocketClosed(ctx, playerId));
  }

  private async run(current: WebSocket | null, fn: (ctx: Ctx) => void): Promise<void> {
    const ctx: Ctx = { state: this.room!, now: Date.now(), random: cryptoRandom, effects: [], changed: false };
    fn(ctx);
    for (const effect of ctx.effects) {
      if (effect.kind === "wipe") return this.wipe();
      this.apply(current, effect);
    }
    if (ctx.changed) {
      await this.ctx.storage.put(STATE_KEY, this.room);
      this.broadcast({ type: "room_state", room: publicRoom(this.room!) });
    }
    await this.scheduleAlarm();
  }

  private apply(current: WebSocket | null, e: Effect): void {
    switch (e.kind) {
      case "reply":
        if (current) this.sendTo(current, e.msg);
        return;
      case "bind":
        current?.serializeAttachment({ playerId: e.playerId } satisfies Attachment);
        return;
      case "send":
        for (const ws of this.socketsOf(e.playerId)) this.sendTo(ws, e.msg);
        return;
      case "broadcast":
        this.broadcast(e.msg);
        return;
      case "closeCurrent":
        if (current) {
          current.serializeAttachment({ playerId: null } satisfies Attachment);
          current.close(CLOSE_LEFT, "left");
        }
        return;
      case "closePlayer":
        for (const ws of this.socketsOf(e.playerId)) {
          if (ws === current) continue;
          ws.serializeAttachment({ playerId: null } satisfies Attachment);
          ws.close(CLOSE_REPLACED, "replaced");
        }
        return;
    }
  }

  private socketsOf(playerId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.playerId === playerId);
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.playerId) this.sendRaw(ws, data);
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string): void {
    try { ws.send(data); } catch { /* socket closing */ }
  }

  private async scheduleAlarm(): Promise<void> {
    const at = this.room ? nextWakeTime(this.room) : null;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  private async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(CLOSE_NOT_FOUND, "room expired"); } catch { /* ignore */ }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = null;
  }
}
```

- [ ] **Step 5: Implement the Worker entry**

`backend/src/index.ts`:
```ts
import { cryptoRandom } from "./random";
import { generateRoomCode } from "./roomCode";

export { GameRoom } from "./GameRoom";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const WS_ROUTE = /^\/api\/rooms\/([A-Za-z0-9]{1,12})\/ws$/;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode(cryptoRandom);
        const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
        if (await stub.init(code)) return json({ roomId: code });
      }
      return json({ error: "NO_FREE_CODE" }, 503);
    }

    const match = url.pathname.match(WS_ROUTE);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const code = match[1].toUpperCase();
      return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code)).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "NOT_FOUND" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: Regenerate types and typecheck**

Run:
```
npm run types -w backend
npm run typecheck -w backend
```
Expected:
- `worker-configuration.d.ts` now has `GAME_ROOM: DurableObjectNamespace<import("./src/index").GameRoom>` (or equivalent) and `ASSETS: Fetcher`.
- Typecheck prints **no errors**. If `Object.values(new WebSocketPair())` is typed as `WebSocket[]` and destructuring complains, use `const pair = new WebSocketPair(); const client = pair[0], server = pair[1];`.

- [ ] **Step 7: Write the smoke script**

`backend/scripts/smoke.mjs`:
```js
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
```

- [ ] **Step 8: Run the smoke test against `wrangler dev`**

In one terminal (background): `npm run dev`
Expected: builds the frontend stub, then wrangler prints `Ready on http://localhost:8787`.

In another: `npm run smoke`
Expected: every line `ok - …` and finally `SMOKE PASSED` within ~5 s.

Also open `http://localhost:8787/` in a browser. It should show the stub text "Mimic Party Mini", which proves static assets are served. `http://localhost:8787/mimic-party-mini.html` should serve the same file.

Stop `wrangler dev` afterwards.

- [ ] **Step 9: Checkpoint**

`npm test -w backend` passes, `npm run typecheck -w backend` is clean, and the smoke test passed. No commit.
