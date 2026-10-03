import { describe, expect, it } from "vitest";
import { PRODUCTION_SERVER, resolveServer } from "../src/config.js";

const loc = (href) => new URL(href);

describe("resolveServer", () => {
  it("uses the page's own origin when served over http(s)", () => {
    expect(resolveServer(loc("http://localhost:8787/?room=ABCDE"))).toEqual({ http: "http://localhost:8787", ws: "ws://localhost:8787" });
    expect(resolveServer(loc("https://mimic.x.workers.dev/"))).toEqual({ http: "https://mimic.x.workers.dev", ws: "wss://mimic.x.workers.dev" });
  });

  it("falls back to PRODUCTION_SERVER for file://", () => {
    const r = resolveServer(loc("file:///C:/Users/me/mimic-party-mini.html"));
    expect(r.http).toBe(PRODUCTION_SERVER.replace(/\/+$/, ""));
    expect(r.ws.startsWith("ws")).toBe(true);
  });

  it("lets ?server= override everything", () => {
    expect(resolveServer(loc("file:///x.html?server=http://localhost:8787/"))).toEqual({ http: "http://localhost:8787", ws: "ws://localhost:8787" });
  });
});
