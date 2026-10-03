import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/rateLimit";

describe("TokenBucket", () => {
  it("allows a burst of 20, then refills at 10/s", () => {
    const b = new TokenBucket(10, 20, 0);
    for (let i = 0; i < 20; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.dropped).toBe(1);
    expect(b.take(100)).toBe(true); // 0.1 s -> 1 token
    expect(b.take(100)).toBe(false);
    expect(b.dropped).toBe(2);
  });

  it("never exceeds the burst size", () => {
    const b = new TokenBucket(10, 20, 0);
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (b.take(60_000)) allowed++;
    expect(allowed).toBe(20);
  });
});
