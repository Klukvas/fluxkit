import { ActionButton } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StickyBuyBar, type StickyBuyBarProps } from "./sticky-buy-bar";
import { findElements, leftoverText } from "./test-helpers";

const props: StickyBuyBarProps = {
  visible: true,
  price: null,
  note: "§note",
  quantity: 1,
  min: 1,
  max: 5,
  canAdd: true,
  addLabel: "§add",
  loadingLabel: "§adding",
  doneLabel: "§added",
  decreaseLabel: "§decrease",
  increaseLabel: "§increase",
  onQuantity: () => undefined,
  onAdd: () => undefined,
};

describe("the phone buy bar's shared add action", () => {
  it("passes the exact clicked button so closing the drawer returns focus there", () => {
    const onAdd = vi.fn();
    const [button] = findElements(
      StickyBuyBar({ ...props, onAdd }),
      (element) => element.type === ActionButton,
    );
    const opener = {};
    (button?.props.onClick as (event: unknown) => void)({ currentTarget: opener });
    expect(onAdd).toHaveBeenCalledWith(opener);
  });

  it("keeps its loading add focusable while the existing form blocks repeats", () => {
    const html = renderToStaticMarkup(<StickyBuyBar {...props} canAdd={false} state="loading" />);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-busy="true"/);
    const [button] = findElements(
      StickyBuyBar({ ...props, canAdd: false, state: "loading" }),
      (element) => element.type === ActionButton,
    );
    expect(button?.props.disabled).toBeFalsy();
    expect(button?.props.tabIndex).toBe(-1);
    expect(leftoverText(html).replace(/[+−]/g, "").trim()).toBe("");
  });

  it("uses all three translated labels without replacing the idle label during loading", () => {
    const [button] = findElements(
      StickyBuyBar({ ...props, state: "done" }),
      (element) => element.type === ActionButton,
    );
    expect(button?.props.idleLabel).toBe("§add");
    expect(button?.props.loadingLabel).toBe("§adding");
    expect(button?.props.doneLabel).toBe("§added");
  });
});

it("keeps the exhausted add button focusable and ignores a click", () => {
  const onAdd = vi.fn();
  const tree = StickyBuyBar({ ...props, canAdd: false, state: "done", onAdd });
  const [button] = findElements(tree, (element) => element.type === ActionButton);
  expect(button?.props.disabled).toBeFalsy();
  expect(button?.props["aria-disabled"]).toBe(true);
  (button?.props.onClick as (event: unknown) => void)({
    currentTarget: {},
    preventDefault: vi.fn(),
  });
  expect(onAdd).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(tree)).toContain("aria-disabled:opacity-50");
});
