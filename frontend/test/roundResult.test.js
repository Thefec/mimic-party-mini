// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoundResultView } from "../src/screens/phases/roundResult.js";

const features = { energy: [-10, -12, -11], pitch: [200, 210, 220], centroid: [1000, 1100, 1200] };
const clip = { audio: "", features };

function state() {
  return {
    self: { id: "a" },
    room: {
      round: 1,
      players: [
        { id: "a", name: "Ayşe", avatar: { body: 0, color: 1, eyes: 0, hat: 0 } },
        { id: "b", name: "Batu", avatar: { body: 0, color: 2, eyes: 0, hat: 0 } },
        { id: "c", name: "Can", avatar: { body: 0, color: 3, eyes: 0, hat: 0 } },
      ],
    },
    roundResult: {
      round: 1,
      performerId: "a",
      skipped: false,
      original: clip,
      performerPoints: 40,
      results: [
        { playerId: "b", submitted: true, score: 80, breakdown: { rhythm: 90, pitch: 70, tone: 60 }, clip },
        { playerId: "c", submitted: false, score: 0, breakdown: null, clip: null },
      ],
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0); // curves are drawn on the next frame; not under test here
  vi.stubGlobal("AudioContext", class { constructor() { this.state = "suspended"; } }); // sfx stays silent
});

describe("round result view", () => {
  it("renders one row per mimic (sorted by score) and never stringified elements", () => {
    const view = createRoundResultView(state());
    const rows = view.el.querySelectorAll(".result-row[data-id]");
    expect(Array.from(rows).map((r) => r.dataset.id)).toEqual(["b", "c"]);
    expect(view.el.textContent).not.toContain("[object");
    expect(view.el.textContent).toContain("80");
    expect(view.el.textContent).toContain("Göndermedi");
  });

  it("explains the score in words and says how it is computed", () => {
    const view = createRoundResultView(state());
    expect(view.el.querySelector(".result-row[data-id='b'] .rating")?.textContent).toBe("Çok iyi!");
    expect(view.el.querySelector(".score-explain")?.textContent).toContain("ritim");
  });
});
