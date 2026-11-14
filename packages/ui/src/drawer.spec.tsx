import { describe, expect, it, vi } from "vitest";
import { cancelDrawer, Drawer } from "./drawer";
import { nativeCloseAction, openModal, type DialogLike } from "./dialog-focus";
import { first, render, tags, text } from "./test-helpers";

describe("Drawer", () => {
  const markup = () =>
    render(
      <Drawer
        open
        title="Cart"
        closeLabel="Close cart"
        onClose={() => undefined}
        footer={<a href="/cart">View cart</a>}
      >
        <p>Lines</p>
      </Drawer>,
    );
  it("uses native modal opening rather than a server open attribute and labels the heading", () => {
    const html = markup();
    expect(first(html, "dialog").attributes).not.toHaveProperty("open");
    expect(first(html, "dialog").attributes["aria-labelledby"]).toBe(
      first(html, "h2").attributes.id,
    );
    expect(text(html)).toBe("Cart Lines View cart");
  });
  it("has a real backdrop button excluded from tab order and an initial-focus close button", () => {
    const buttons = tags(markup(), "button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.attributes).toMatchObject({
      type: "button",
      tabindex: "-1",
      "aria-label": "Close cart",
    });
    expect(buttons[1]?.attributes).toHaveProperty("data-autofocus");
  });
  it("cancels Escape's native mutation and requests the controlled close", () => {
    const preventDefault = vi.fn();
    const onClose = vi.fn();
    cancelDrawer({ preventDefault }, onClose);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(nativeCloseAction(true, false, true)).toBe("close");
    expect(nativeCloseAction(true, true, true)).toBe("ignore");
  });
  it("opens modally and restores focus using the shared helper", () => {
    const focus = vi.fn();
    const dialog: DialogLike = {
      open: false,
      showModal: vi.fn(),
      close: vi.fn(),
      querySelector: () => null,
    };
    const close = openModal(dialog, { isConnected: true, focus });
    expect(dialog.showModal).toHaveBeenCalledOnce();
    close();
    expect(focus).toHaveBeenCalledOnce();
  });
});
