import type { CartStore } from "./cart-store";
import type { SaveOutcome } from "./quantity-autosave";

/**
 * The cart page's actions as the callbacks its view takes, one per control, each doing exactly one thing to the cart store.
 * The island spreads this object into the view, so a control and its action cannot be wired to different names.
 */
export function cartPageHandlers(store: CartStore) {
  return {
    onRetry: (): void => {
      void store.refresh();
    },
    /** The line shows a failure itself (next to its quantity), so it is not reported in the page's alert as well. */
    onSetQuantity: async (variantId: string, quantity: number): Promise<SaveOutcome> => {
      const outcome = await store.setQuantity(variantId, quantity, { reportFailure: false });
      return outcome.status === "ok" ? { status: "ok" } : outcome;
    },
    onRemove: (variantId: string): void => {
      void store.remove(variantId);
    },
    onAcknowledge: (): void => {
      void store.acknowledge();
    },
    onDismissFailure: (): void => {
      store.dismissFailure();
    },
  };
}
