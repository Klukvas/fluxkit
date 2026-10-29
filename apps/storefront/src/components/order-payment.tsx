"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sessionAttemptStorage, webAttemptCrypto } from "../lib/checkout-attempt";
import { createPaymentAttemptManager, type PaymentAttemptManager } from "../lib/payment-attempt";
import type { PaymentSectionModel } from "../lib/payment-model";
import { goToProvider } from "../lib/payment-redirect";
import { paymentReturnHref } from "../lib/payment-return";
import {
  initialPayState,
  payFocusTarget,
  createPayStore,
  type PaySource,
  type PayState,
  type PayStore,
} from "../lib/payment-store";
import { useI18n } from "./i18n-provider";
import { PAYMENT_FOCUS_IDS, PaymentSectionView } from "./payment-section";

/** The epoch milliseconds, ticking every second while a wait is running (and not at all otherwise). */
function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return now;
}

/** Moves the focus to the message when a start was refused (`payFocusTarget`); the message is also announced. */
function usePayFocus(state: PayState): void {
  const previous = useRef(state);
  useEffect(() => {
    const target = payFocusTarget(previous.current, state);
    previous.current = state;
    if (target !== null) document.getElementById(PAYMENT_FOCUS_IDS[target])?.focus();
  }, [state]);
}

/**
 * The payment section of one order page (guest or customer). `source` is the guest or account twin
 * (`payment-store.ts`); the page re-reads the order through `onOrderChanged` when a start shows the order moved on. The
 * store keeps its state across renders; the browser parts (`sessionStorage`, the navigation) are made here, in the browser
 * only. The page renders this only when `paymentSection` found something to show.
 */
export function OrderPayment({
  model,
  orderExpiresAt,
  source,
  onOrderChanged,
  onSignedOut,
}: {
  model: PaymentSectionModel;
  orderExpiresAt: string;
  source: PaySource;
  onOrderChanged: () => void;
  onSignedOut?: () => void;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [store, setStore] = useState<PayStore | null>(null);
  const callbacks = useRef({ onOrderChanged, onSignedOut });
  callbacks.current = { onOrderChanged, onSignedOut };

  useEffect(() => {
    const storage = sessionAttemptStorage(() => window.sessionStorage);
    let manager: PaymentAttemptManager | null = null;
    setStore(
      createPayStore({
        source,
        // Made on the first use: Web Crypto exists only in a secure context, and the store reports its absence.
        attempts: () => {
          manager ??= createPaymentAttemptManager({
            storage,
            crypto: webAttemptCrypto(globalThis.crypto),
          });
          return manager;
        },
        returnStorage: storage,
        navigate: (url) => goToProvider(window, url),
        onOrderChanged: () => callbacks.current.onOrderChanged(),
        onSignedOut: () => callbacks.current.onSignedOut?.(),
      }),
    );
  }, [source]);

  const state = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.getState() ?? initialPayState,
    () => initialPayState,
  );
  const now = useNow(state.waitUntil);
  usePayFocus(state);

  return (
    <PaymentSectionView
      t={t}
      locale={locale}
      model={model}
      orderExpiresAt={orderExpiresAt}
      pay={state}
      now={now}
      onPay={() => void store?.pay()}
      onContinue={(url, paymentId) => store?.continuePayment(url, paymentId)}
      onCheckStatus={(paymentId) => {
        store?.rememberReturn(paymentId);
        router.push(paymentReturnHref(locale, paymentId));
      }}
    />
  );
}
