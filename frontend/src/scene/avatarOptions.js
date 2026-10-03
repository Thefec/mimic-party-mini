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
