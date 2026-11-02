import { describe, expect, it, vi } from "vitest";
import { cartPageHandlers } from "./cart-handlers";
import type { CartStore } from "./cart-store";

function fakeStore() {
  const outcome = Promise.resolve({ status: "failed", failure: {} });
  return {
    refresh: vi.fn(() => outcome),
    setQuantity: vi.fn(() => outcome),
    remove: vi.fn(() => outcome),
    acknowledge: vi.fn(() => outcome),
    dismissFailure: vi.fn(),
  };
}

describe("cartPageHandlers", () => {
  it("sends each control to its own store action, with its arguments", () => {
    const store = fakeStore();
    const handlers = cartPageHandlers(store as unknown as CartStore);
    handlers.onRetry();
    expect(store.refresh).toHaveBeenCalledTimes(1);
    void handlers.onSetQuantity("v1", 4);
    // The line shows its own failure, so the shared page alert must not show it as well.
    expect(store.setQuantity).toHaveBeenCalledWith("v1", 4, { reportFailure: false });
    // A save sent after the shopper left the page has no line to show its failure: the shared cart reports it.
    void handlers.onSetQuantity("v1", 5, true);
    expect(store.setQuantity).toHaveBeenLastCalledWith("v1", 5, { reportFailure: true });
    handlers.onRemove("v2");
    expect(store.remove).toHaveBeenCalledWith("v2");
    handlers.onAcknowledge();
    expect(store.acknowledge).toHaveBeenCalledTimes(1);
    handlers.onDismissFailure();
    expect(store.dismissFailure).toHaveBeenCalledTimes(1);
    // Nothing else was called by any of them.
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(store.setQuantity).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.acknowledge).toHaveBeenCalledTimes(1);
  });
});
