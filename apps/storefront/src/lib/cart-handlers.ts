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
    /**
     * The line shows a failure itself (next to its quantity), so it is not reported in the page's alert as well; a `final`
     * save (sent after the shopper left the page, review M1 of PR 211) has no line any more, so its failure is reported.
     */
    onSetQuantity: async (
      variantId: string,
      quantity: number,
      final = false,
    ): Promise<SaveOutcome> => {
      const outcome = await store.setQuantity(variantId, quantity, { reportFailure: final });
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
