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
      // Look slightly below the character so it sits above the bottom UI panel.
      pos = new THREE.Vector3(x * 0.6, 2.4, z + 5.5);
      look = new THREE.Vector3(x, 0.3, z);
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
