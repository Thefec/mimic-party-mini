# Task 9: Client core — config, strings, prefs, state, clock, connection

**Files:**
- Create: `frontend/src/config.js`, `frontend/src/strings.js`, `frontend/src/prefs.js`, `frontend/src/state.js`, `frontend/src/clock.js`, `frontend/src/connection.js`
- Test: `frontend/test/config.test.js`, `frontend/test/clock.test.js`

**Interfaces:**
- Consumes: the server protocol (Task 2 types and Task 6 close codes).
- Produces:
  - `config.js`: `PRODUCTION_SERVER`, `resolveServer(location?) → { http, ws }`
  - `strings.js`: `T` (all Turkish UI text). The key groups used later are `T.title`, `T.menu.*`, `T.avatar.*`, `T.lobby.*`, `T.mic.*`, `T.game.*`, `T.results.*`, `T.connection.*`, `T.errors[code]`, and `T.prompt(p)` for bubbles.
  - `prefs.js`: `loadPref(key, fallback)`, `savePref(key, value)`, and the constants `PREF_NAME`, `PREF_AVATAR`, `PREF_MIC`
  - `state.js`: `state`, `update(mutator)`, `subscribe(fn) → unsubscribe`, `serverNow()`, `selfPlayer()`, `isHost()`, `resetRoom()`, `showError(code)`
  - `clock.js`: `estimateOffset(samples[{t, serverTime, receivedAt}]) → ms`
  - `connection.js`: `createRoom() → Promise<roomId>`, `joinRoom(roomId, name, avatar)`, `tryResume(name, avatar) → boolean`, `send(msg)`, `leave()`, `onMessage(fn) → unsubscribe`

State shape (read by every screen):
```js
{
  connection: "idle" | "connecting" | "open" | "reconnecting" | "closed",
  self: null | { id, name, avatar },
  room: null | PublicRoom,       // server snapshot, patched by phase_changed / submission_received
  phaseData: null | PhaseData,
  roundResult: null | RoundResult,
  standings: null | Standing[],
  clockOffset: 0,                 // serverTime - clientTime (ms)
  local: { error: null | string, errorAt: 0 },
}
```

- [ ] **Step 1: Write failing tests**

`frontend/test/config.test.js`:
```js
import { describe, expect, it } from "vitest";
import { PRODUCTION_SERVER, resolveServer } from "../src/config.js";

const loc = (href) => new URL(href);

describe("resolveServer", () => {
  it("uses the page's own origin when served over http(s)", () => {
    expect(resolveServer(loc("http://localhost:8787/?room=ABCDE"))).toEqual({ http: "http://localhost:8787", ws: "ws://localhost:8787" });
    expect(resolveServer(loc("https://mimic.x.workers.dev/"))).toEqual({ http: "https://mimic.x.workers.dev", ws: "wss://mimic.x.workers.dev" });
  });

  it("falls back to PRODUCTION_SERVER for file://", () => {
    const r = resolveServer(loc("file:///C:/Users/me/mimic-party-mini.html"));
    expect(r.http).toBe(PRODUCTION_SERVER.replace(/\/+$/, ""));
    expect(r.ws.startsWith("ws")).toBe(true);
  });

  it("lets ?server= override everything", () => {
    expect(resolveServer(loc("file:///x.html?server=http://localhost:8787/"))).toEqual({ http: "http://localhost:8787", ws: "ws://localhost:8787" });
  });
});
```

`frontend/test/clock.test.js`:
```js
import { describe, expect, it } from "vitest";
import { estimateOffset } from "../src/clock.js";

describe("estimateOffset", () => {
  it("is 0 without samples", () => {
    expect(estimateOffset([])).toBe(0);
  });

  it("uses the lowest-latency sample and assumes symmetric delay", () => {
    // Server is 5000 ms ahead of the client.
    const samples = [
      { t: 1000, receivedAt: 1400, serverTime: 6300 }, // rtt 400 (noisy)
      { t: 2000, receivedAt: 2040, serverTime: 7020 }, // rtt 40 -> offset 7020 - 2020 = 5000
    ];
    expect(estimateOffset(samples)).toBe(5000);
  });
});
```

Run: `npm test -w frontend` → FAIL (missing modules).

- [ ] **Step 2: Implement `config.js` and `clock.js`**

`frontend/src/config.js`:
```js
// Production backend, used only when the HTML file is opened from disk (file://).
// Replace after the first `npm run deploy` (see README).
export const PRODUCTION_SERVER = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";

export function resolveServer(location = window.location) {
  const override = new URLSearchParams(location.search).get("server");
  const served = location.protocol === "http:" || location.protocol === "https:";
  const http = (override || (served ? location.origin : PRODUCTION_SERVER)).replace(/\/+$/, "");
  return { http, ws: http.replace(/^http/, "ws") };
}
```

`frontend/src/clock.js`:
```js
/** Estimate serverTime - clientTime from ping/pong samples, trusting the lowest round trip. */
export function estimateOffset(samples) {
  if (!samples.length) return 0;
  let best = samples[0];
  for (const s of samples) if (s.receivedAt - s.t < best.receivedAt - best.t) best = s;
  const rtt = best.receivedAt - best.t;
  return best.serverTime - (best.t + rtt / 2);
}
```

Run: `npm test -w frontend` → config and clock tests PASS.

- [ ] **Step 3: Strings**

`frontend/src/strings.js`:
```js
export const T = {
  title: "Mimic Party Mini",
  prompt: (p) => `“${p}”`,

  menu: {
    nickname: "Takma adın",
    nicknamePlaceholder: "ör. Batu",
    create: "Oda kur",
    join: "Katıl",
    roomCode: "Oda kodu",
    or: "ya da bir odaya katıl",
    randomize: "Rastgele",
    body: "Gövde",
    color: "Renk",
    eyes: "Gözler",
    hat: "Aksesuar",
    needName: "Önce bir takma ad yaz.",
    needCode: "5 karakterlik oda kodunu yaz.",
  },

  avatar: {
    body: ["Fasulye", "Kutu", "Koni", "Top"],
    eyes: ["Yuvarlak", "Uykulu", "Kızgın", "Fıldır"],
    hat: ["Yok", "Kep", "Parti şapkası", "Taç", "Kulaklık", "Fiyonk"],
  },

  lobby: {
    roomCode: "Oda kodu",
    copyCode: "Kodu kopyala",
    copyLink: "Linki kopyala",
    copied: "Kopyalandı!",
    players: (n) => `Oyuncular ${n}/6`,
    cycles: "Herkes kaç kez sahneye çıksın?",
    cyclesOption: (c) => `${c}×`,
    start: "Oyunu başlat",
    needPlayers: "Başlamak için en az 2 oyuncu gerekli.",
    waitingHost: (name) => `${name} oyunu başlatacak…`,
    editAvatar: "Karakterini düzenle",
    done: "Tamam",
    leave: "Odadan çık",
  },

  mic: {
    title: "Mikrofon",
    test: "Mikrofonu test et",
    select: "Mikrofon",
    denied: "Mikrofon izni verilmedi. Adres çubuğundaki kilit simgesinden izin verebilirsin.",
    unsupported: "Bu tarayıcıda mikrofon kullanılamıyor.",
  },

  game: {
    round: (r, t) => `Tur ${r}/${t}`,
    introTitle: "Sıradaki",
    intro: (name) => `Sahnede: ${name}`,
    promptHint: (p) => `Öneri: ${p}`,
    performTitle: "Performans",
    performYou: "Bir ses çıkar ya da taklit yap!",
    performOther: (name) => `${name} ses kaydediyor…`,
    recordingBubble: "🎙️ kaydediyor…",
    mimicTitle: "Taklit zamanı",
    mimicYou: "Dinle ve aynısını yap!",
    mimicYouPerformer: "Herkes seni taklit ediyor!",
    listen: "Orijinali dinle",
    submittedCount: (a, b) => `${a}/${b} taklit geldi`,
    record: "Kaydet",
    stop: "Durdur",
    rerecord: "Tekrar kaydet",
    play: "Dinle",
    send: "Gönder",
    sent: "Gönderildi ✔ Diğerleri bekleniyor…",
    tooQuiet: "Ses çok kısa ya da çok sessiz, tekrar dene.",
    keysHint: "Boşluk: kaydet / durdur · Enter: gönder",
    resultTitle: "Tur sonucu",
    resultHeading: (name) => `${name} taklitleri`,
    skipped: "Tur atlandı — ses gelmedi.",
    original: "Orijinal",
    performerPoints: (p) => `Performans puanı +${p}`,
    notSubmitted: "Göndermedi",
    rhythm: "Ritim",
    pitch: "Melodi",
    tone: "Tını",
  },

  results: {
    title: "Sonuçlar",
    winner: (name) => `Kazanan: ${name}!`,
    tie: "Berabere!",
    points: (p) => `${p} puan`,
    playAgain: "Tekrar oyna",
    waitingHost: "Host yeni oyunu başlatabilir.",
    leave: "Odadan çık",
  },

  connection: {
    connecting: "Bağlanıyor…",
    reconnecting: "Bağlantı koptu, yeniden bağlanılıyor…",
  },

  errors: {
    ROOM_NOT_FOUND: "Böyle bir oda yok (ya da süresi doldu).",
    ROOM_FULL: "Oda dolu (en fazla 6 kişi).",
    INVALID_NAME: "Takma ad 1–16 karakter olmalı.",
    INVALID_MESSAGE: "Bir şeyler ters gitti, tekrar dene.",
    INVALID_ACTION: "Bunu şu an yapamazsın.",
    NOT_HOST: "Bunu sadece host yapabilir.",
    NOT_ENOUGH_PLAYERS: "En az 2 oyuncu gerekli.",
    GAME_ALREADY_STARTED: "Oyun çoktan başladı.",
    INVALID_PHASE: "Bunun için artık geç.",
    ALREADY_SUBMITTED: "Zaten gönderdin.",
    RATE_LIMITED: "Biraz yavaş!",
    SESSION_EXPIRED: "Oturumun sona erdi.",
    CONNECTION_ERROR: "Sunucuya bağlanılamadı.",
    REPLACED: "Oyun başka bir sekmede açıldı.",
    MIC_DENIED: "Mikrofon izni verilmedi.",
    MIC_UNSUPPORTED: "Bu tarayıcıda mikrofon kullanılamıyor.",
    WEBGL: "Bu oyun 3D grafik (WebGL) gerektiriyor. Güncel Chrome, Edge ya da Firefox kullan.",
  },
};
```

- [ ] **Step 4: Prefs and state**

`frontend/src/prefs.js`:
```js
export const PREF_NAME = "mimic.name";
export const PREF_AVATAR = "mimic.avatar";
export const PREF_MIC = "mimic.micDeviceId";

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference is simply not remembered */
  }
}
```

`frontend/src/state.js`:
```js
const listeners = new Set();

export const state = {
  connection: "idle",
  self: null,
  room: null,
  phaseData: null,
  roundResult: null,
  standings: null,
  clockOffset: 0,
  local: { error: null, errorAt: 0 },
};

export function update(mutator) {
  mutator(state);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const serverNow = () => Date.now() + state.clockOffset;
export const selfPlayer = () => state.room?.players.find((p) => p.id === state.self?.id) ?? null;
export const isHost = () => !!state.self && state.room?.hostId === state.self.id;

export function resetRoom() {
  update((s) => {
    s.self = null;
    s.room = null;
    s.phaseData = null;
    s.roundResult = null;
    s.standings = null;
  });
}

export function showError(code) {
  update((s) => {
    s.local.error = code;
    s.local.errorAt = Date.now();
  });
}
```

- [ ] **Step 5: Connection**

`frontend/src/connection.js`:
```js
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
```

Notes for the implementer:
- `phase_changed` with `data: null` (result phases) does not overwrite `phaseData`. The result arrives separately as `round_result` / `game_result`.
- Terminal close codes send the player back to the menu with a message. Every other close retries with exponential backoff (0.5 s → 8 s) and rejoins with the stored token.

- [ ] **Step 6: Run tests and build**

Run: `npm test -w frontend` → PASS.
Run: `npm run build` → succeeds. These modules are not imported by `main.js` yet; the build only proves nothing else broke.

- [ ] **Step 7: Checkpoint**

`npm test` passes. No commit.
