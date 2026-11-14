"use client";

import type { CartLine } from "@fluxkit/api-client";
import { Button, NumberRoll, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { quantityStepperMax } from "../lib/cart-model";
import { failureText } from "../lib/failure";
import {
  createQuantityAutosave,
  idleAutosave,
  type QuantityAutosave,
  type SaveOutcome,
} from "../lib/quantity-autosave";

export interface DrawerQuantityProps {
  line: CartLine;
  disabled: boolean;
  t: Translator;
  onSetQuantity(id: string, quantity: number, final: boolean): Promise<SaveOutcome>;
  registerLine(id: string, autosave: QuantityAutosave): () => void;
}

/** A display draft only: the shared autosave applies server answers and flushes even when the drawer closes. */
export function CartDrawerQuantity({
  line,
  disabled,
  t,
  onSetQuantity,
  registerLine,
}: DrawerQuantityProps) {
  const serverQuantity = useRef(line.quantity);
  serverQuantity.current = line.quantity;
  const [autosave, setAutosave] = useState<QuantityAutosave | null>(null);
  const state = useSyncExternalStore(
    (listener) => autosave?.subscribe(listener) ?? (() => {}),
    () => autosave?.getState() ?? idleAutosave,
    () => idleAutosave,
  );
  const { variantId } = line;
  useEffect(() => {
    const created = createQuantityAutosave({
      save: (quantity, final) => onSetQuantity(variantId, quantity, final),
      serverQuantity: () => serverQuantity.current,
    });
    setAutosave(created);
    const unregister = registerLine(variantId, created);
    return () => {
      unregister();
      created.dispose();
    };
  }, [variantId, onSetQuantity, registerLine]);
  const quantity = state.draft ?? line.quantity;
  const unavailable = disabled || autosave === null;
  return (
    <div aria-busy={state.pending} className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={t("cart.line.quantity", { title: line.title })}
        className="inline-flex items-center gap-2"
      >
        <Button
          variant="secondary"
          className="min-h-11 min-w-11"
          aria-label={t("cart.line.decrease", { title: line.title })}
          disabled={unavailable || quantity <= 1}
          onClick={() => autosave?.change(quantity - 1)}
        >
          <span aria-hidden="true">−</span>
        </Button>
        <NumberRoll value={quantity} className="min-w-8 text-center" />
        <Button
          variant="secondary"
          className="min-h-11 min-w-11"
          aria-label={t("cart.line.increase", { title: line.title })}
          disabled={unavailable || quantity >= quantityStepperMax(line)}
          onClick={() => autosave?.change(quantity + 1)}
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>
      <span className="min-h-5 text-sm text-muted-foreground">
        {state.pending ? t("cart.line.saving") : ""}
      </span>
      {state.failure === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {t("cart.line.saveFailed", { reason: failureText(t, state.failure) })}
        </p>
      )}
    </div>
  );
}
