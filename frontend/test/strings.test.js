import { describe, expect, it } from "vitest";
import { T } from "../src/strings.js";

describe("score rating words", () => {
  it("maps score bands to encouraging words", () => {
    expect(T.game.rating(100)).toBe("Mükemmel!");
    expect(T.game.rating(85)).toBe("Mükemmel!");
    expect(T.game.rating(84)).toBe("Çok iyi!");
    expect(T.game.rating(70)).toBe("Çok iyi!");
    expect(T.game.rating(50)).toBe("İyi");
    expect(T.game.rating(30)).toBe("Fena değil");
    expect(T.game.rating(29)).toBe("Pek benzemedi");
    expect(T.game.rating(0)).toBe("Pek benzemedi");
  });
});
