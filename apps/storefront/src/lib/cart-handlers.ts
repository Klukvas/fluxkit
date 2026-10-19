import type { CartStore } from "./cart-store";

/**
 * The cart page's actions as the callbacks its view takes, one per control, each doing exactly one thing to the cart store.
 * The island spreads this object into the view, so a control and its action cannot be wired to different names.
 */
export function cartPageHandlers(store: CartStore) {
  return {
    onRetry: (): void => {
      void store.refresh();
    },
    onSetQuantity: (variantId: string, quantity: number): void => {
      void store.setQuantity(variantId, quantity);
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
