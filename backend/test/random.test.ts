import { describe, expect, it } from "vitest";
import { cryptoRandom, randomHex } from "../src/random";

describe("random", () => {
  it("cryptoRandom returns numbers in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const v = cryptoRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("randomHex returns lowercase hex of the requested length", () => {
    const hex = randomHex(cryptoRandom, 32);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it("randomHex is deterministic for a fixed source", () => {
    expect(randomHex(() => 0, 4)).toBe("0000");
    expect(randomHex(() => 0.99999, 4)).toBe("ffff");
  });
});
