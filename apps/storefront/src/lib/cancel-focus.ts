import type { CancelState } from "./order-store";

/**
 * Where the keyboard focus goes when the control the shopper just used disappears (an order's cancel steps swap their
 * buttons in place, and a removed element drops the focus to the page start). Pure, so every transition has a test;
 * `components/use-cancel-focus.ts` applies the answer.
 */
export type CancelFocusTarget = "ask" | "keep" | "status";

export const CANCEL_FOCUS_IDS: Record<CancelFocusTarget, string> = {
  ask: "order-cancel-ask",
  keep: "order-cancel-keep",
  status: "order-cancel-status",
};

export function cancelFocusTarget(
  before: CancelState,
  after: CancelState,
): CancelFocusTarget | null {
  // The cancel succeeded: the buttons are gone for good, the message that says so receives the focus.
  if (!before.done && after.done) return "status";
  // The question appeared: focus the safe answer, so pressing Enter twice does not cancel the order.
  if (!before.confirming && after.confirming) return "keep";
  // The question went away without a success ("keep the order", or a refused cancel): back to the button that asked it.
  if (before.confirming && !after.confirming) return "ask";
  return null;
}
