import { estimateOffset } from "./clock.js";
import { resolveServer } from "./config.js";
import { resetRoom, showError, update } from "./state.js";

const SESSION_KEY = "mimic.session"; // sessionStorage: per tab
const TERMINAL_CLOSE = { 1000: null, 4000: "REPLACED", 4404: "ROOM_NOT_FOUND", 4429: "RATE_LIMITED" };
const JOIN_ERRORS = new Set(["ROOM_NOT_FOUND", "ROOM_FULL", "INVALID_NAME", "GAME_ALREADY_STARTED", "SESSION_EXPIRED"]);

let ws = null;
let joinInfo = null; // { roomId, playerName, avatar, sessionToken }
let joined = false;
let intentionalClose = false;
let retry = 0;
let retryTimer = 0;
let pingTimer = 0;
const pings = [];
const handlers = new Set();

export function onMessage(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
}
function saveSession(value) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch { /* ignore */ }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export async function createRoom() {
  const res = await fetch(`${resolveServer().http}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error("CONNECTION_ERROR");
  const { roomId } = await res.json();
  return roomId;
}

export function joinRoom(roomId, playerName, avatar) {
  if (ws) return;
  const saved = loadSession();
  joinInfo = { roomId, playerName, avatar, sessionToken: saved?.roomId === roomId ? saved.sessionToken : undefined };
  retry = 0;
  open();
}

/** Rejoin the room stored for this tab (page reload). Returns false if there is nothing to resume. */
export function tryResume(playerName, avatar) {
  const saved = loadSession();
  if (!saved) return false;
  joinRoom(saved.roomId, playerName, avatar);
  return true;
}

export function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function leave() {
  send({ type: "leave_room" });
  shutdown();
  resetRoom();
}

function shutdown() {
  intentionalClose = true;
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  clearSession();
  joinInfo = null;
  joined = false;
  if (ws) {
    try { ws.close(1000); } catch { /* ignore */ }
    ws = null;
  }
  update((s) => { s.connection = "closed"; });
}

function open() {
  intentionalClose = false;
  update((s) => { s.connection = retry ? "reconnecting" : "connecting"; });
  const socket = new WebSocket(`${resolveServer().ws}/api/rooms/${encodeURIComponent(joinInfo.roomId)}/ws`);
  ws = socket;

  socket.onopen = () => {
    const { playerName, avatar, sessionToken } = joinInfo;
    socket.send(JSON.stringify({ type: "join_room", playerName, avatar, sessionToken }));
    ping();
    clearInterval(pingTimer);
    pingTimer = setInterval(ping, 5000);
  };

  socket.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handle(msg);
  };

  socket.onclose = (event) => {
    if (ws !== socket) return; // an old socket
    ws = null;
    clearInterval(pingTimer);
    if (intentionalClose) return;
    if (event.code in TERMINAL_CLOSE) {
      const code = TERMINAL_CLOSE[event.code];
      shutdown();
      resetRoom();
      if (code) showError(code);
      return;
    }
    if (!joined && retry >= 2) {
      shutdown();
      resetRoom();
      showError("CONNECTION_ERROR");
      return;
    }
    const delay = Math.min(8000, 500 * 2 ** retry);
    retry++;
    update((s) => { s.connection = "reconnecting"; });
    retryTimer = setTimeout(open, delay);
  };
}

function ping() {
  send({ type: "ping", t: Date.now() });
}

function handle(msg) {
  switch (msg.type) {
    case "joined":
      joined = true;
      retry = 0;
      joinInfo.sessionToken = msg.player.sessionToken;
      saveSession({ roomId: msg.room.id, sessionToken: msg.player.sessionToken });
      update((s) => {
        s.connection = "open";
        s.self = { id: msg.player.id, name: msg.player.name, avatar: msg.player.avatar };
        s.room = msg.room;
        s.phaseData = msg.phaseData;
        s.roundResult = msg.room.phase === "ROUND_RESULT" ? msg.phaseData : null;
        s.standings = msg.room.phase === "GAME_RESULT" ? msg.phaseData?.standings ?? null : null;
      });
      break;
    case "room_state":
      update((s) => { s.room = msg.room; });
      break;
    case "phase_changed":
      update((s) => {
        if (msg.data !== null || msg.phase === "LOBBY") s.phaseData = msg.data;
        if (msg.phase === "ROUND_INTRO" || msg.phase === "LOBBY") s.roundResult = null;
        if (msg.phase === "LOBBY") s.standings = null;
        if (s.room) {
          s.room.phase = msg.phase;
          s.room.round = msg.round;
          s.room.phaseEndsAt = msg.endsAt;
          if (msg.phase !== "MIMIC" && msg.phase !== "ROUND_RESULT") s.room.submitted = [];
        }
      });
      break;
    case "submission_received":
      update((s) => {
        if (s.room && !s.room.submitted.includes(msg.playerId)) s.room.submitted.push(msg.playerId);
      });
      break;
    case "round_result": {
      const { type, ...result } = msg;
      update((s) => { s.roundResult = result; });
      break;
    }
    case "game_result":
      update((s) => { s.standings = msg.standings; });
      break;
    case "pong":
      pings.push({ t: msg.t, serverTime: msg.serverTime, receivedAt: Date.now() });
      if (pings.length > 8) pings.shift();
      update((s) => { s.clockOffset = estimateOffset(pings); });
      break;
    case "error":
      if (!joined && JOIN_ERRORS.has(msg.code)) {
        shutdown();
        resetRoom();
      }
      showError(msg.code);
      break;
  }
  for (const fn of handlers) fn(msg);
}
