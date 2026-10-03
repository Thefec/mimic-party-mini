# Task 8: 3D stage, characters, labels, director, prototype (user review gate)

**Files:**
- Create: `frontend/src/ui/dom.js`
- Create: `frontend/src/scene/avatarOptions.js`, `frontend/src/scene/character.js`, `frontend/src/scene/stage.js`, `frontend/src/scene/labels.js`, `frontend/src/scene/director.js`
- Create: `frontend/prototype/index.html`, `frontend/prototype/prototype.js`
- Test: `frontend/test/avatarOptions.test.js`, `frontend/test/dom.test.js`

**Interfaces:**
- Consumes: backend `AVATAR_LIMITS` (Task 2; test only). Styles from `src/styles.css` (the Task 1 stub is enough for the prototype; the labels get real styling in Task 10).
- Produces:
  - `dom.js`: `h(tag, props?, ...children): HTMLElement`. Children and `text` are always inserted as text nodes.
  - `avatarOptions.js`: `BODIES`, `COLORS`, `EYES`, `HATS`, `AVATAR_OPTIONS = { body, color, eyes, hat }`, `randomAvatar(random?)`, `isAvatar(v)`
  - `character.js`: `class Character` — `root: THREE.Group`, `headAnchor: THREE.Object3D`, `setAvatar(avatar)`, `update(dt, t)`, `setTalk(level 0..1)`, `jump(v?)`, `setSleeping(bool)`, `setCelebrating(bool)`, `dispose()`
  - `stage.js`: `SLOT_COUNT = 6`, `slotTransform(i) → { x, z, angle }`, `class Stage(canvas)` — `start()`, `syncPlayers(players[{id, avatar, connected}])`, `characterOf(id)`, `setSpotlight(slot|null)`, `focus(slot|null)`, `setPodium(standings|null)`, `confetti()`, `screenPosition(id) → {x, y, visible} | null`, `onFrame(fn) → unsubscribe`
  - `labels.js`: `class Labels(container, stage)` — `set(id, { name, host, sleeping, self, badge, bubble })`, `sync(ids)`
  - `director.js`: `createDirector(stage, labels, { levelFor(id, state) → 0..1, text: { recording, prompt(p) } }) → { sync(state) }`

`director.js` deliberately imports nothing from the app (no strings, no audio). The app passes those in (Task 12), and so does the prototype. That keeps this task buildable and reviewable on its own.

- [ ] **Step 1: Write failing tests**

`frontend/test/avatarOptions.test.js`:
```js
import { describe, expect, it } from "vitest";
import { AVATAR_LIMITS } from "../../backend/src/config.ts";
import { AVATAR_OPTIONS, isAvatar, randomAvatar } from "../src/scene/avatarOptions.js";

describe("avatar options", () => {
  it("match the server's validation ranges exactly", () => {
    for (const key of Object.keys(AVATAR_LIMITS)) expect(AVATAR_OPTIONS[key]).toHaveLength(AVATAR_LIMITS[key]);
    expect(Object.keys(AVATAR_OPTIONS).sort()).toEqual(Object.keys(AVATAR_LIMITS).sort());
  });

  it("randomAvatar stays in range", () => {
    for (let i = 0; i < 200; i++) expect(isAvatar(randomAvatar())).toBe(true);
    expect(randomAvatar(() => 0.9999)).toEqual({ body: 3, color: 9, eyes: 3, hat: 5 });
  });

  it("isAvatar rejects junk (e.g. a corrupted localStorage value)", () => {
    expect(isAvatar(null)).toBe(false);
    expect(isAvatar({ body: 9, color: 0, eyes: 0, hat: 0 })).toBe(false);
    expect(isAvatar({ body: "0", color: 0, eyes: 0, hat: 0 })).toBe(false);
  });
});
```

`frontend/test/dom.test.js`:
```js
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { h } from "../src/ui/dom.js";

describe("h()", () => {
  it("renders hostile names as text, never as markup", () => {
    const el = h("div", {}, "<img src=x onerror=alert(1)>", h("b", { text: "<script>x</script>" }));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toBe("<img src=x onerror=alert(1)><script>x</script>");
  });

  it("sets class, attributes and event listeners, and skips null/false children", () => {
    const onClick = vi.fn();
    const el = h("button", { class: "btn", hidden: true, title: false, "data-x": "1", onclick: onClick }, null, false, "Go", 3);
    expect(el.className).toBe("btn");
    expect(el.hasAttribute("hidden")).toBe(true);
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.dataset.x).toBe("1");
    expect(el.textContent).toBe("Go3");
    el.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("flattens child arrays", () => {
    const el = h("ul", {}, ["a", "b"].map((t) => h("li", {}, t)));
    expect(el.children).toHaveLength(2);
  });
});
```

Run: `npm test -w frontend`. Expected: FAIL (missing modules).

- [ ] **Step 2: Implement `dom.js`**

`frontend/src/ui/dom.js`:
```js
/**
 * Tiny element builder. Strings are always inserted as text nodes, so user
 * content (names) can never become markup.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
```

- [ ] **Step 3: Implement `avatarOptions.js`**

`frontend/src/scene/avatarOptions.js`:
```js
export const BODIES = ["bean", "box", "cone", "ball"];
export const COLORS = ["#ff5d5d", "#ff9f1c", "#ffd23f", "#7bd389", "#2ec4b6", "#3a86ff", "#8338ec", "#ff66c4", "#f4f1de", "#6d6875"];
export const EYES = ["round", "sleepy", "angry", "googly"];
export const HATS = ["none", "cap", "party", "crown", "headphones", "bow"];

export const AVATAR_OPTIONS = { body: BODIES, color: COLORS, eyes: EYES, hat: HATS };

export function randomAvatar(random = Math.random) {
  const pick = (list) => Math.floor(random() * list.length);
  return { body: pick(BODIES), color: pick(COLORS), eyes: pick(EYES), hat: pick(HATS) };
}

export function isAvatar(v) {
  if (!v || typeof v !== "object") return false;
  return Object.entries(AVATAR_OPTIONS).every(([k, list]) => Number.isInteger(v[k]) && v[k] >= 0 && v[k] < list.length);
}
```

Run: `npm test -w frontend` → the avatarOptions and dom tests PASS.

- [ ] **Step 4: Implement `character.js`**

`frontend/src/scene/character.js`:
```js
import * as THREE from "three";
import { BODIES, COLORS, EYES, HATS } from "./avatarOptions.js";

// Geometry per body type. y = center height, faceY/faceZ = where the face sits, top = head top, headR = hat scale.
const BODY_SHAPES = {
  bean: { make: () => new THREE.CapsuleGeometry(0.5, 0.6, 3, 8), y: 0.8, faceY: 1.05, faceZ: 0.47, top: 1.6, headR: 0.5 },
  box: { make: () => new THREE.BoxGeometry(1.0, 1.4, 0.9), y: 0.7, faceY: 0.95, faceZ: 0.46, top: 1.4, headR: 0.5 },
  cone: { make: () => new THREE.ConeGeometry(0.72, 1.7, 7), y: 0.85, faceY: 0.72, faceZ: 0.42, top: 1.62, headR: 0.3 },
  ball: { make: () => new THREE.IcosahedronGeometry(0.72, 1), y: 0.72, faceY: 0.85, faceZ: 0.68, top: 1.4, headR: 0.6 },
};

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.05, ...extra });

// Shared materials are never disposed.
const WHITE = mat("#ffffff");
const BLACK = mat("#1d1d1f");
const MOUTH = mat("#3b0d1c");
const GOLD = mat("#ffc933", { metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide });
const SHARED = new Set([WHITE, BLACK, MOUTH, GOLD]);
const GREY = new THREE.Color("#8a8a95");

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (!SHARED.has(o.material)) o.material.dispose();
    }
  });
}

function buildEyes(style) {
  const group = new THREE.Group();
  const pupils = [];
  const r = style === "googly" ? 0.16 : 0.11;
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.x = side * 0.18;
    const white = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), WHITE);
    white.scale.set(1, style === "sleepy" ? 0.45 : 1, 0.6);
    const pupil = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.5, 1), BLACK);
    pupil.position.z = r * 0.5;
    if (style === "sleepy") pupil.scale.y = 0.5;
    eye.add(white, pupil);
    if (style === "angry") {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), BLACK);
      brow.position.set(0, r + 0.05, 0.05);
      brow.rotation.z = side * 0.45; // inner ends down
      eye.add(brow);
    }
    pupils.push(pupil);
    group.add(eye);
  }
  return { group, pupils };
}

function buildHat(kind, accent) {
  const g = new THREE.Group();
  const m = mat(accent);
  switch (kind) {
    case "cap": {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), m);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.35), m);
      visor.position.set(0, 0.02, 0.45);
      g.add(dome, visor);
      break;
    }
    case "party": {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 8), m);
      cone.position.y = 0.27;
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), GOLD);
      ball.position.y = 0.57;
      g.add(cone, ball);
      break;
    }
    case "crown": {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 8, 1, true), GOLD);
      band.position.y = 0.08;
      g.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), GOLD);
        spike.position.set(Math.sin(a) * 0.27, 0.24, Math.cos(a) * 0.27);
        g.add(spike);
      }
      break;
    }
    case "headphones": {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 14, Math.PI), mat("#2a2a33"));
      band.position.y = -0.3;
      g.add(band);
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), m);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.55, -0.3, 0);
        g.add(cup);
      }
      break;
    }
    case "bow": {
      const bow = new THREE.Group();
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 6), m);
        wing.rotation.z = side * (Math.PI / 2);
        wing.position.x = side * 0.12;
        bow.add(wing);
      }
      bow.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), m));
      bow.position.set(0.22, 0, 0.1);
      bow.rotation.z = -0.35;
      g.add(bow);
      break;
    }
    default:
      break; // "none"
  }
  return g;
}

export class Character {
  constructor(avatar) {
    this.root = new THREE.Group();
    this.bouncer = new THREE.Group();
    this.root.add(this.bouncer);
    this.headAnchor = new THREE.Object3D();
    this.bouncer.add(this.headAnchor);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.root.add(this.shadow);

    this.talk = 0;
    this.targetTalk = 0;
    this.vy = 0;
    this.jumpY = 0;
    this.sleeping = false;
    this.celebrating = false;
    this.greyness = 0;
    this.seed = Math.random() * 10;
    this.nextBlink = 2 + Math.random() * 3;
    this.blinkT = 0;
    this.setAvatar(avatar);
  }

  setAvatar(avatar) {
    this.avatar = { ...avatar };
    for (const child of [...this.bouncer.children]) {
      if (child === this.headAnchor) continue;
      this.bouncer.remove(child);
      disposeTree(child);
    }
    const shape = BODY_SHAPES[BODIES[avatar.body]];
    this.baseColor = new THREE.Color(COLORS[avatar.color]);
    this.bodyMat = mat(COLORS[avatar.color]);

    const body = new THREE.Mesh(shape.make(), this.bodyMat);
    body.position.y = shape.y;

    const face = new THREE.Group();
    face.position.set(0, shape.faceY, shape.faceZ);
    this.eyes = buildEyes(EYES[avatar.eyes]);
    this.eyes.group.position.y = 0.12;
    this.mouth = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), MOUTH);
    this.mouth.position.set(0, -0.12, 0.02);
    this.mouth.scale.set(1.4, 0.3, 0.5);
    face.add(this.eyes.group, this.mouth);

    const hat = buildHat(HATS[avatar.hat], COLORS[(avatar.color + 5) % COLORS.length]);
    hat.position.y = shape.top - 0.08;
    hat.scale.setScalar(shape.headR / 0.5);

    this.bouncer.add(body, face, hat);
    this.headAnchor.position.set(0, shape.top + 0.75, 0);
  }

  setTalk(level) { this.targetTalk = Math.max(0, Math.min(1, level)); }
  jump(v = 4) { if (this.jumpY === 0 && this.vy === 0) this.vy = v; }
  setSleeping(on) { this.sleeping = on; }
  setCelebrating(on) {
    if (this.celebrating && !on) this.bouncer.rotation.y = 0;
    this.celebrating = on;
  }

  update(dt, t) {
    this.talk += (this.targetTalk - this.talk) * Math.min(1, dt * 18);

    if (this.jumpY > 0 || this.vy > 0) {
      this.vy -= 14 * dt;
      this.jumpY = Math.max(0, this.jumpY + this.vy * dt);
      if (this.jumpY === 0) this.vy = 0;
    }
    if (this.celebrating && this.jumpY === 0 && this.vy === 0) this.jump(3 + Math.random());

    const breathe = Math.sin(t * (this.sleeping ? 1.2 : 2) + this.seed) * (this.sleeping ? 0.03 : 0.02);
    const squash = 1 + breathe + this.talk * 0.06;
    this.bouncer.position.y = this.jumpY + this.talk * 0.12 * Math.abs(Math.sin(t * 14));
    this.bouncer.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.bouncer.rotation.z = this.sleeping ? 0.18 : Math.sin(t * 1.3 + this.seed) * 0.03;
    if (this.celebrating) this.bouncer.rotation.y += dt * 4;

    this.mouth.scale.y = 0.3 + this.talk * 1.6;

    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0.12;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.blinkT = Math.max(0, this.blinkT - dt);
    this.eyes.group.scale.y = this.sleeping ? 0.15 : this.blinkT > 0 ? 0.1 : 1;

    if (EYES[this.avatar.eyes] === "googly") {
      this.eyes.pupils.forEach((p, i) => {
        p.position.x = Math.sin(t * 9 + i * 2 + this.seed) * 0.04;
        p.position.y = Math.cos(t * 7 + i) * 0.04;
      });
    }

    this.greyness += ((this.sleeping ? 1 : 0) - this.greyness) * Math.min(1, dt * 4);
    this.bodyMat.color.copy(this.baseColor).lerp(GREY, this.greyness * 0.7);
    this.shadow.scale.setScalar(1 - Math.min(0.5, this.jumpY * 0.3));
  }

  dispose() {
    disposeTree(this.root);
  }
}
```

- [ ] **Step 5: Implement `stage.js`**

`frontend/src/scene/stage.js`:
```js
import * as THREE from "three";
import { Character } from "./character.js";

export const SLOT_COUNT = 6;

const CAMERA_HOME = new THREE.Vector3(0, 3.6, 9.5);
const LOOK_HOME = new THREE.Vector3(0, 1.1, -1);
const PODIUM = [
  { x: 0, y: 0.9, z: -0.6 },
  { x: -1.7, y: 0.6, z: -0.4 },
  { x: 1.7, y: 0.35, z: -0.4 },
];

/** Slots lie on an arc (center (0,4), radius 6); characters face the arc's center, i.e. the audience. */
export function slotTransform(i) {
  const angle = -0.75 + (1.5 * i) / (SLOT_COUNT - 1);
  return { x: 6 * Math.sin(angle), z: 4 - 6 * Math.cos(angle), angle };
}

const avatarKey = (a) => `${a.body}-${a.color}-${a.eyes}-${a.hat}`;
const approach = (from, to, rate, dt) => from + (to - from) * Math.min(1, dt * rate);

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#2b1f4a");
    this.scene.fog = new THREE.Fog("#2b1f4a", 16, 32);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camPos = CAMERA_HOME.clone();
    this.camLook = LOOK_HOME.clone();
    this.focusIndex = null;
    this.spotIndex = null;
    this.spotStrength = 0;
    this.podium = null; // Map id -> rank index
    this.characters = new Map(); // id -> { character, slot, key, dropping }
    this.frameCallbacks = new Set();
    this.clock = new THREE.Clock();
    this.tmp = new THREE.Vector3();

    this.buildEnvironment();
    this.buildMicStands();
    this.buildSpotlight();
    this.buildPodium();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  buildEnvironment() {
    this.scene.add(new THREE.HemisphereLight("#ffe9c7", "#3b2a66", 1.1));
    const key = new THREE.DirectionalLight("#ffffff", 1.3);
    key.position.set(3, 8, 6);
    this.scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(7.5, 7.8, 0.5, 24),
      new THREE.MeshStandardMaterial({ color: "#7a4b2a", flatShading: true, roughness: 0.9 }),
    );
    floor.position.set(0, -0.25, 2.2);
    this.scene.add(floor);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: "#1e1535" }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.scene.add(ground);

    for (let i = -9; i <= 9; i++) {
      const fold = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 9, 0.4),
        new THREE.MeshStandardMaterial({ color: i % 2 ? "#a3203b" : "#c22a48", flatShading: true }),
      );
      fold.position.set(i, 4, -5 + i * i * 0.035);
      this.scene.add(fold);
    }

    const bulbColors = ["#ffd23f", "#ff66c4", "#2ec4b6", "#ff9f1c"];
    for (let i = 0; i < 24; i++) {
      const x = -9 + (18 * i) / 23;
      const bulb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.09, 0),
        new THREE.MeshBasicMaterial({ color: bulbColors[i % bulbColors.length] }),
      );
      bulb.position.set(x, 7.2 - Math.cos((x / 9) * Math.PI * 0.5) * 0.8, -4.4 + x * x * 0.03);
      this.scene.add(bulb);
    }
  }

  buildMicStands() {
    const metal = new THREE.MeshStandardMaterial({ color: "#3a3a44", flatShading: true, metalness: 0.4, roughness: 0.5 });
    const head = new THREE.MeshStandardMaterial({ color: "#c0c0d0", flatShading: true, metalness: 0.6, roughness: 0.35 });
    this.micStands = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const { x, z, angle } = slotTransform(i);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.06, 8), metal);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), metal);
      pole.position.y = 0.6;
      const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 2, 6), head);
      mic.position.set(0, 1.25, -0.1);
      mic.rotation.x = -0.9;
      g.add(base, pole, mic);
      // In front of the slot, toward the arc center (the audience).
      g.position.set(x - Math.sin(angle) * 0.95, 0, z + Math.cos(angle) * 0.95);
      g.rotation.y = -angle;
      this.scene.add(g);
      this.micStands.push(g);
    }
  }

  buildSpotlight() {
    this.spot = new THREE.SpotLight("#fff3c4", 0, 0, 0.32, 0.5, 0);
    this.spot.position.set(0, 9, 3);
    this.scene.add(this.spot, this.spot.target);
    this.spotDisk = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 24),
      new THREE.MeshBasicMaterial({ color: "#fff1b0", transparent: true, opacity: 0, depthWrite: false }),
    );
    this.spotDisk.rotation.x = -Math.PI / 2;
    this.spotDisk.position.y = 0.02;
    this.scene.add(this.spotDisk);
  }

  buildPodium() {
    this.podiumGroup = new THREE.Group();
    const colors = ["#ffc933", "#c8ccd8", "#d08a4a"];
    PODIUM.forEach((p, i) => {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, p.y, 1.2),
        new THREE.MeshStandardMaterial({ color: colors[i], flatShading: true }),
      );
      block.position.set(p.x, p.y / 2, p.z);
      this.podiumGroup.add(block);
    });
    this.podiumGroup.visible = false;
    this.scene.add(this.podiumGroup);
  }

  // ------------------------------------------------------------ public API

  syncPlayers(players) {
    const seen = new Set();
    players.slice(0, SLOT_COUNT).forEach((p, slot) => {
      seen.add(p.id);
      let entry = this.characters.get(p.id);
      if (!entry) {
        const character = new Character(p.avatar);
        const { x, z } = slotTransform(slot);
        character.root.position.set(x, 3, z);
        this.scene.add(character.root);
        entry = { character, slot, key: avatarKey(p.avatar), dropping: true };
        this.characters.set(p.id, entry);
      }
      if (entry.key !== avatarKey(p.avatar)) {
        entry.character.setAvatar(p.avatar);
        entry.key = avatarKey(p.avatar);
        entry.character.jump(3);
      }
      entry.slot = slot;
      entry.character.setSleeping(!p.connected);
    });
    for (const [id, entry] of this.characters) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.character.root);
      entry.character.dispose();
      this.characters.delete(id);
    }
  }

  characterOf(id) { return this.characters.get(id)?.character ?? null; }
  setSpotlight(slot) { this.spotIndex = slot; }
  focus(slot) { this.focusIndex = slot; }

  /** standings: [{playerId, rank}] sorted best first, or null to leave podium mode. */
  setPodium(standings) {
    this.podium = standings ? new Map(standings.map((s, i) => [s.playerId, i])) : null;
    this.podiumGroup.visible = !!standings;
    for (const stand of this.micStands) stand.visible = !standings;
  }

  screenPosition(id) {
    const entry = this.characters.get(id);
    if (!entry) return null;
    entry.character.headAnchor.getWorldPosition(this.tmp);
    this.tmp.project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h, visible: this.tmp.z < 1 };
  }

  onFrame(fn) {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  /** A burst of low-poly confetti over the stage for ~6 s. */
  confetti() {
    const colors = ["#ffd23f", "#ff66c4", "#2ec4b6", "#ff5d5d", "#3a86ff", "#7bd389"];
    const geometry = new THREE.PlaneGeometry(0.12, 0.2);
    const materials = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    const group = new THREE.Group();
    for (let i = 0; i < 160; i++) {
      const piece = new THREE.Mesh(geometry, materials[i % materials.length]);
      piece.position.set((Math.random() - 0.5) * 10, 6 + Math.random() * 4, -1 + (Math.random() - 0.5) * 4);
      piece.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.8, -1.2 - Math.random() * 1.5, 0);
      piece.userData.spin = new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      group.add(piece);
    }
    this.scene.add(group);
    const born = this.clock.elapsedTime;
    const off = this.onFrame((dt, t) => {
      for (const p of group.children) {
        p.position.addScaledVector(p.userData.v, dt);
        p.rotation.x += p.userData.spin.x * dt;
        p.rotation.y += p.userData.spin.y * dt;
        p.rotation.z += p.userData.spin.z * dt;
      }
      if (t - born > 6) {
        off();
        this.scene.remove(group);
        geometry.dispose();
        for (const m of materials) m.dispose();
      }
    });
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ frame

  targetFor(entry, id) {
    if (this.podium) {
      const rank = this.podium.get(id);
      if (rank !== undefined && rank < PODIUM.length) return { ...PODIUM[rank], angle: 0 };
      const extra = (rank ?? 3) - PODIUM.length;
      return { x: (extra % 2 ? 1 : -1) * (3.3 + Math.floor(extra / 2) * 1.3), y: 0, z: -0.2, angle: 0 };
    }
    const { x, z, angle } = slotTransform(entry.slot);
    return { x, y: 0, z, angle };
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    for (const [id, entry] of this.characters) {
      const c = entry.character;
      const target = this.targetFor(entry, id);
      c.root.position.x = approach(c.root.position.x, target.x, 6, dt);
      c.root.position.z = approach(c.root.position.z, target.z, 6, dt);
      if (entry.dropping) {
        c.root.position.y = approach(c.root.position.y, target.y, 7, dt);
        if (Math.abs(c.root.position.y - target.y) < 0.03) {
          c.root.position.y = target.y;
          entry.dropping = false;
          c.jump(3.5);
        }
      } else {
        c.root.position.y = approach(c.root.position.y, target.y, 8, dt);
      }
      c.root.rotation.y = -target.angle;
      c.update(dt, t);
    }

    const on = this.spotIndex !== null;
    this.spotStrength = approach(this.spotStrength, on ? 1 : 0, 5, dt);
    if (on) {
      const { x, z } = slotTransform(this.spotIndex);
      this.spotDisk.position.x = approach(this.spotDisk.position.x, x, 8, dt);
      this.spotDisk.position.z = approach(this.spotDisk.position.z, z, 8, dt);
      this.spot.target.position.copy(this.spotDisk.position);
    }
    this.spot.intensity = this.spotStrength * 4;
    this.spotDisk.material.opacity = this.spotStrength * 0.35;

    let pos = CAMERA_HOME;
    let look = LOOK_HOME;
    if (this.focusIndex !== null && !this.podium) {
      const { x, z } = slotTransform(this.focusIndex);
      pos = this.tmp.set(x * 0.6, 2.6, z + 5.5).clone();
      look = new THREE.Vector3(x, 1.0, z);
    }
    this.camPos.lerp(pos, Math.min(1, dt * 2.5));
    this.camLook.lerp(look, Math.min(1, dt * 2.5));
    this.camera.position.copy(this.camPos);
    this.camera.position.x += Math.sin(t * 0.25) * 0.25;
    this.camera.lookAt(this.camLook);

    for (const fn of this.frameCallbacks) fn(dt, t);
    this.renderer.render(this.scene, this.camera);
  }
}
```

- [ ] **Step 6: Implement `labels.js`**

`frontend/src/scene/labels.js`:
```js
import { h } from "../ui/dom.js";

/** HTML labels (name, badge, speech bubble) pinned above each character's head. */
export class Labels {
  constructor(container, stage) {
    this.container = container;
    this.stage = stage;
    this.items = new Map();
    stage.onFrame(() => this.position());
  }

  set(id, { name, host = false, sleeping = false, self = false, badge = "", bubble = "" }) {
    let item = this.items.get(id);
    if (!item) {
      const nameEl = h("div", { class: "label-name" });
      const badgeEl = h("div", { class: "label-badge" });
      const bubbleEl = h("div", { class: "label-bubble" });
      const el = h("div", { class: "label" }, bubbleEl, badgeEl, nameEl);
      this.container.append(el);
      item = { el, nameEl, badgeEl, bubbleEl };
      this.items.set(id, item);
    }
    item.nameEl.textContent = `${host ? "★ " : ""}${name}${sleeping ? " 💤" : ""}`;
    item.el.classList.toggle("self", self);
    if (item.badgeEl.textContent !== badge) {
      item.badgeEl.textContent = badge;
      item.badgeEl.classList.remove("pop");
      void item.badgeEl.offsetWidth; // restart the pop animation
      if (badge) item.badgeEl.classList.add("pop");
    }
    item.badgeEl.hidden = !badge;
    item.bubbleEl.textContent = bubble;
    item.bubbleEl.hidden = !bubble;
  }

  sync(ids) {
    for (const [id, item] of this.items) {
      if (ids.includes(id)) continue;
      item.el.remove();
      this.items.delete(id);
    }
  }

  position() {
    for (const [id, item] of this.items) {
      const p = this.stage.screenPosition(id);
      if (!p || !p.visible) {
        item.el.style.visibility = "hidden";
        continue;
      }
      item.el.style.visibility = "visible";
      item.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  }
}
```

- [ ] **Step 7: Implement `director.js`**

`frontend/src/scene/director.js`:
```js
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
```

- [ ] **Step 8: Prototype page**

`frontend/prototype/index.html`:
```html
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Mimic Party Mini — sahne prototipi</title>
<!--STYLE-->
<style>
  #stage { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
  #labels { position: fixed; inset: 0; pointer-events: none; }
  .label { position: absolute; left: 0; top: 0; text-align: center; font: 700 15px system-ui; color: #fff; text-shadow: 0 2px 4px #000; white-space: nowrap; text-transform: none; letter-spacing: 0; }
  .label-badge { font-size: 22px; color: #ffd23f; }
  .label-bubble { background: #fff; color: #222; border-radius: 12px; padding: 4px 10px; margin-bottom: 4px; text-shadow: none; }
  #controls { position: fixed; left: 12px; top: 12px; display: flex; flex-wrap: wrap; gap: 6px; max-width: 520px; }
  #controls button { font: 600 13px system-ui; padding: 6px 10px; border-radius: 8px; border: 0; cursor: pointer; }
</style>
</head>
<body>
<canvas id="stage"></canvas>
<div id="labels"></div>
<div id="controls"></div>
<!--SCRIPT-->
</body>
</html>
```

`frontend/prototype/prototype.js`:
```js
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
```

- [ ] **Step 9: Build and run the prototype**

Run: `npm run prototype`
Expected: prints `built prototype\dist\index.html (… KB)`.

Open `frontend/prototype/dist/index.html` in Chrome (double-click; `file://` is fine for WebGL). Verify manually:
- 4 characters drop onto the stage and bounce, each behind a mic stand, with name labels above their heads.
- "🎲 avatarlar" repeatedly: every body, eye and hat type appears at some point. Hats sit on heads, and the face stays visible on every body type (cone included).
- "🗣️ performer konuşsun": the first character's mouth and body move for 2 s.
- `ROUND_INTRO`: spotlight plus camera zoom on the first player, with a "Robot" bubble. `MIMIC`: ✔ on players 2–3. `ROUND_RESULT`: +scores appear and the best player jumps. `GAME_RESULT`: podium and confetti, and the winner spins and jumps.
- "💤 son oyuncu": that character turns grey, tilts and shows 💤.
- With 6 players, the animation stays smooth (no visible stutter) at full-window size.

Fix obvious geometry problems now, for example eyes buried inside the cone. Adjust the `BODY_SHAPES` face values; that is a numbers-only change.

- [ ] **Step 10: USER REVIEW GATE — stop here**

Tell the user (in Turkish) that the prototype is ready. Give them the command `npm run prototype` and the file path to open. Ask for feedback on the look: colors, shapes, camera, and anything they want changed. Apply the requested tweaks, rebuild, and ask again. **Do not start Task 9 until the user approves the look.**

- [ ] **Step 11: Checkpoint**

`npm test` passes (both workspaces) and the user approved the scene. No commit.
