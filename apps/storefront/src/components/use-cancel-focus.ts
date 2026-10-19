import { useEffect, useRef } from "react";
import { CANCEL_FOCUS_IDS, cancelFocusTarget } from "../lib/cancel-focus";
import type { CancelState } from "../lib/order-store";

/** Moves the focus along the order's cancel steps (`lib/cancel-focus.ts`); the elements carry the ids of `OrderDetailsView`. */
export function useCancelFocus(cancel: CancelState): void {
  const previous = useRef(cancel);
  useEffect(() => {
    const target = cancelFocusTarget(previous.current, cancel);
    previous.current = cancel;
    if (target !== null) document.getElementById(CANCEL_FOCUS_IDS[target])?.focus();
  }, [cancel]);
}
