import { describe, expect, it, vi } from "vitest";
import { CART_CHANGED_EVENT, publishCartChange, subscribeToCartChanges } from "./cart-events";

describe("cart change events", () => {
  it("delivers the new item count to every subscriber of the same target", () => {
    const target = new EventTarget();
    const first = vi.fn();
    const second = vi.fn();
    subscribeToCartChanges(first, target);
    subscribeToCartChanges(second, target);
    publishCartChange({ itemCount: 3 }, target);
    expect(first).toHaveBeenCalledWith({ itemCount: 3 });
    expect(second).toHaveBeenCalledWith({ itemCount: 3 });
  });

  it("stops delivering after unsubscribe, and only to that listener", () => {
    const target = new EventTarget();
    const kept = vi.fn();
    const dropped = vi.fn();
    subscribeToCartChanges(kept, target);
    const unsubscribe = subscribeToCartChanges(dropped, target);
    unsubscribe();
    publishCartChange({ itemCount: 1 }, target);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("does not cross between targets (a test or an iframe never sees another page's cart)", () => {
    const one = new EventTarget();
    const other = new EventTarget();
    const listener = vi.fn();
    subscribeToCartChanges(listener, one);
    publishCartChange({ itemCount: 2 }, other);
    expect(listener).not.toHaveBeenCalled();
  });

  it("uses one documented event name", () => {
    expect(CART_CHANGED_EVENT).toBe("fluxkit:cart-changed");
    const target = new EventTarget();
    const seen: Event[] = [];
    target.addEventListener(CART_CHANGED_EVENT, (event) => seen.push(event));
    publishCartChange({ itemCount: 0 }, target);
    expect(seen).toHaveLength(1);
  });

  it("accepts an empty cart and refuses a count that cannot be an item count", () => {
    const target = new EventTarget();
    expect(() => publishCartChange({ itemCount: 0 }, target)).not.toThrow();
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => publishCartChange({ itemCount: bad }, target), String(bad)).toThrow(RangeError);
    }
  });

  it("ignores a foreign event with the same name but a malformed detail instead of passing it on", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    subscribeToCartChanges(listener, target);
    target.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { itemCount: "many" } }));
    target.dispatchEvent(new Event(CART_CHANGED_EVENT));
    expect(listener).not.toHaveBeenCalled();
  });
});
