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
