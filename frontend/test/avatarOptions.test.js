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
