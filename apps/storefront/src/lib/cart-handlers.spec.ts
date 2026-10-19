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
    handlers.onSetQuantity("v1", 4);
    expect(store.setQuantity).toHaveBeenCalledWith("v1", 4);
    handlers.onRemove("v2");
    expect(store.remove).toHaveBeenCalledWith("v2");
    handlers.onAcknowledge();
    expect(store.acknowledge).toHaveBeenCalledTimes(1);
    handlers.onDismissFailure();
    expect(store.dismissFailure).toHaveBeenCalledTimes(1);
    // Nothing else was called by any of them.
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(store.setQuantity).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.acknowledge).toHaveBeenCalledTimes(1);
  });
});
