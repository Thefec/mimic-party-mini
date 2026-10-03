import { h } from "../ui/dom.js";

/** HTML labels (name, badge, speech bubble) pinned above each character's head. */
export class Labels {
  constructor(container, stage) {
    this.container = container;
    this.stage = stage;
    this.items = new Map();
    stage.onFrame(() => this.position());
  }

  set(id, { name, host = false, sleeping = false, self = false, badge = "", bubble = "" }) {
    let item = this.items.get(id);
    if (!item) {
      const nameEl = h("div", { class: "label-name" });
      const badgeEl = h("div", { class: "label-badge" });
      const bubbleEl = h("div", { class: "label-bubble" });
      const el = h("div", { class: "label" }, bubbleEl, badgeEl, nameEl);
      this.container.append(el);
      item = { el, nameEl, badgeEl, bubbleEl };
      this.items.set(id, item);
    }
    item.nameEl.textContent = `${host ? "★ " : ""}${name}${sleeping ? " 💤" : ""}`;
    item.el.classList.toggle("self", self);
    if (item.badgeEl.textContent !== badge) {
      item.badgeEl.textContent = badge;
      item.badgeEl.classList.remove("pop");
      void item.badgeEl.offsetWidth; // restart the pop animation
      if (badge) item.badgeEl.classList.add("pop");
    }
    item.badgeEl.hidden = !badge;
    item.bubbleEl.textContent = bubble;
    item.bubbleEl.hidden = !bubble;
  }

  sync(ids) {
    for (const [id, item] of this.items) {
      if (ids.includes(id)) continue;
      item.el.remove();
      this.items.delete(id);
    }
  }

  position() {
    for (const [id, item] of this.items) {
      const p = this.stage.screenPosition(id);
      if (!p || !p.visible) {
        item.el.style.visibility = "hidden";
        continue;
      }
      item.el.style.visibility = "visible";
      item.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  }
}
