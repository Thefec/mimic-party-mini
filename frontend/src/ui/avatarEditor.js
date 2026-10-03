import * as THREE from "three";
import { Character } from "../scene/character.js";
import { AVATAR_OPTIONS, COLORS, randomAvatar } from "../scene/avatarOptions.js";
import { T } from "../strings.js";
import { h } from "./dom.js";

/** Rotating 3D preview + one ◀ ▶ picker per option + randomize. */
export function createAvatarEditor({ avatar, onChange }) {
  let current = { ...avatar };

  const canvas = h("canvas", { class: "avatar-preview" });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(150, 150, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffe9c7", "#3b2a66", 1.3));
  const key = new THREE.DirectionalLight("#ffffff", 1.4);
  key.position.set(2, 4, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 1.6, 5.2);
  camera.lookAt(0, 1.0, 0);
  const character = new Character(current);
  scene.add(character.root);

  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    character.root.rotation.y += dt * 0.8;
    character.update(dt, clock.elapsedTime);
    renderer.render(scene, camera);
  };
  loop();

  const rows = ["body", "color", "eyes", "hat"].map((k) => {
    const value = h("span", { class: "opt-value" });
    const row = h(
      "div",
      { class: "opt-row" },
      h("span", { class: "opt-label" }, T.menu[k]),
      h("button", { class: "btn small", onclick: () => step(k, -1) }, "◀"),
      value,
      h("button", { class: "btn small", onclick: () => step(k, 1) }, "▶"),
    );
    const render = () => {
      if (k === "color") {
        value.textContent = "";
        value.classList.add("swatch");
        value.style.background = COLORS[current.color];
      } else {
        value.textContent = T.avatar[k][current[k]];
      }
    };
    return { row, render };
  });

  function step(k, delta) {
    const n = AVATAR_OPTIONS[k].length;
    current = { ...current, [k]: (current[k] + delta + n) % n };
    apply();
  }

  function apply() {
    character.setAvatar(current);
    character.jump(3);
    for (const r of rows) r.render();
    onChange({ ...current });
  }

  for (const r of rows) r.render();
  const dice = h("button", { class: "btn small", onclick: () => { current = randomAvatar(); apply(); } }, "🎲 " + T.menu.randomize);
  const el = h("div", { class: "avatar-editor" }, canvas, h("div", { class: "opt-rows" }, rows.map((r) => r.row), dice));

  return {
    el,
    destroy() {
      cancelAnimationFrame(raf);
      character.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
