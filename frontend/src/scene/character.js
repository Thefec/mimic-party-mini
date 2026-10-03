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
