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
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
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
