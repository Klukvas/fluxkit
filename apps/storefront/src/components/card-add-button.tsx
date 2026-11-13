"use client";

import { Button, VisuallyHidden, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CartOutcome } from "../lib/cart-store";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";
import { cardActionLink } from "./styles";

/** How long the button reads "Added" before it offers to add again (the cart badge keeps the count). */
export const CARD_ADDED_MS = 2500;

export type CardAddStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "added" }
  | { state: "failed"; messageKey: string };

/** The button's state after the cart store answered an add: the store's own failure words (`errors.*`), never a made-up one. */
export function statusAfterAdd(outcome: CartOutcome): CardAddStatus {
  return outcome.status === "ok"
    ? { state: "added" }
    : { state: "failed", messageKey: outcome.failure.messageKey };
}

/**
 * Runs `add` unless one is still running (`inFlight` is the island's `useRef` flag). Synchronous on purpose: two clicks in
 * one frame both see the same rendered `pending: false`, but the second one finds the flag already set, so one click is one
 * request.
 */
export async function addOnce(
  inFlight: { current: boolean },
  add: () => Promise<void>,
): Promise<void> {
  if (inFlight.current) return;
  inFlight.current = true;
  try {
    await add();
  } finally {
    inFlight.current = false;
  }
}

export interface CardAddButtonViewProps {
  /** The product title: part of the control's name, so twenty "Add to cart" controls stay distinct for a screen reader. */
  title: string;
  /** The product page: where the control leads before hydration (or without a script), as a plain link. */
  href: string;
  status: CardAddStatus;
  /**
   * False in the server HTML and until hydration: a tap could not reach `onAdd` yet, so the control is a link to the product
   * page (the same place, size and words), where the product can be added with or without a script ready.
   */
  ready: boolean;
  t: Translator;
  onAdd: () => void;
}

/**
 * The add-to-cart button of a product card (owner design 2026-11-13): one unit of the product's only variant. Above the
 * card's stretched link (`relative z-10`) and a sibling of it, never inside it. One control at a time: a link to the product
 * page until the island hydrates, then the button. While adding it stays focusable (`aria-disabled`, like the product page's
 * button). The result is announced through a `role="status"` region that is always mounted; a failure stays visible there in
 * words.
 */
export function CardAddButtonView({
  title,
  href,
  status,
  ready,
  t,
  onAdd,
}: CardAddButtonViewProps) {
  const pending = status.state === "pending";
  const label = pending
    ? t("product.card.adding")
    : status.state === "added"
      ? t("product.card.added")
      : t("product.addToCart");
  const name = (
    <>
      <span>{label}</span> <VisuallyHidden>{title}</VisuallyHidden>
    </>
  );
  return (
    <div className="relative z-10 flex flex-col">
      {ready ? (
        <Button
          variant="secondary"
          aria-disabled={pending}
          aria-busy={pending}
          className="min-h-11 w-full text-sm aria-disabled:opacity-50"
          onClick={onAdd}
        >
          {name}
        </Button>
      ) : (
        <Link href={href} className={cardActionLink}>
          {name}
        </Link>
      )}
      {/* Empty and zero height until something happens: a live region only announces changes to a region that exists. */}
      <p role="status" className="text-sm">
        {status.state === "added" ? <VisuallyHidden>{t("product.added")}</VisuallyHidden> : null}
        {status.state === "failed" ? (
          <span className="mt-1 block text-danger">{t(status.messageKey)}</span>
        ) : null}
      </p>
    </div>
  );
}

/** The island: adds through the shared cart store, whose answer updates the header's cart badge. Prices never leave here. */
export function CardAddButton({
  variantId,
  title,
  href,
}: {
  variantId: string;
  title: string;
  href: string;
}) {
  const { t } = useI18n();
  const { store } = useCart();
  const [status, setStatus] = useState<CardAddStatus>({ state: "idle" });
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => {
    if (status.state !== "added") return;
    const id = window.setTimeout(() => setStatus({ state: "idle" }), CARD_ADDED_MS);
    return () => window.clearTimeout(id);
  }, [status]);

  async function add(): Promise<void> {
    setStatus({ state: "pending" });
    try {
      setStatus(statusAfterAdd(await store.add(variantId, 1)));
    } catch (error) {
      // The store reports every failure the shopper can act on as an outcome; a throw is a bug. Free the button, stay loud.
      setStatus({ state: "failed", messageKey: "errors.generic" });
      throw error;
    }
  }

  return (
    <CardAddButtonView
      title={title}
      href={href}
      status={status}
      ready={ready}
      t={t}
      onAdd={() => {
        void addOnce(inFlight, add);
      }}
    />
  );
}
