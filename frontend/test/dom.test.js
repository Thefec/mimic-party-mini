// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { h } from "../src/ui/dom.js";

describe("h()", () => {
  it("renders hostile names as text, never as markup", () => {
    const el = h("div", {}, "<img src=x onerror=alert(1)>", h("b", { text: "<script>x</script>" }));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toBe("<img src=x onerror=alert(1)><script>x</script>");
  });

  it("sets class, attributes and event listeners, and skips null/false children", () => {
    const onClick = vi.fn();
    const el = h("button", { class: "btn", hidden: true, title: false, "data-x": "1", onclick: onClick }, null, false, "Go", 3);
    expect(el.className).toBe("btn");
    expect(el.hasAttribute("hidden")).toBe(true);
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.dataset.x).toBe("1");
    expect(el.textContent).toBe("Go3");
    el.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("flattens child arrays", () => {
    const el = h("ul", {}, ["a", "b"].map((t) => h("li", {}, t)));
    expect(el.children).toHaveLength(2);
  });
});
