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
