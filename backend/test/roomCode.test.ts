import { describe, expect, it } from "vitest";
import { generateRoomCode, isRoomCode, ROOM_CODE_ALPHABET } from "../src/roomCode";

describe("room codes", () => {
  it("generates 5 characters from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(5);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it("never uses ambiguous characters", () => {
    for (const ch of "O0I1L") expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it("is deterministic for a fixed random source", () => {
    expect(generateRoomCode(() => 0)).toBe("AAAAA");
    expect(generateRoomCode(() => 0.99999)).toBe("99999");
  });

  it("isRoomCode rejects lowercase, wrong length and ambiguous chars", () => {
    expect(isRoomCode("A7K2P")).toBe(true);
    expect(isRoomCode("a7k2p")).toBe(false);
    expect(isRoomCode("A7K2")).toBe(false);
    expect(isRoomCode("A7K2PX")).toBe(false);
    expect(isRoomCode("O0I1L")).toBe(false);
  });
});
