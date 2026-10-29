"use client";

import { Button, Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { sessionAttemptStorage } from "../lib/checkout-attempt";
import { failureText } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { accountOrderHref, accountOrdersHref } from "../lib/order-links";
import { orderStatusKey } from "../lib/order-model";
import { createPaymentWatch, type PaymentWatch, type PaymentWatchState } from "../lib/payment-poll";
import {
  clearPaymentReturn,
  paymentIdFromSearch,
  readPaymentReturn,
  returnOrderHref,
  type PaymentReturn,
} from "../lib/payment-return";
import {
  returnPresentation,
  type ReturnAction,
  type ReturnState,
} from "../lib/payment-return-model";
import { statusReadFor } from "../lib/payment-store";
import { loginHref } from "../lib/safe-next";
import { useI18n } from "./i18n-provider";
import { useStoreClient } from "./session-provider";
import { linkButton } from "./styles";

export const RETURN_RESULT_ID = "payment-return-result";

export interface PaymentReturnViewProps {
  t: Translator;
  locale: Locale;
  state: ReturnState;
  /** What the page knows about the order from its own tab (the hand-off); `null` when it knows nothing. */
  entry: PaymentReturn | null;
  onCheckAgain: () => void;
}

function actionHref(
  action: ReturnAction,
  locale: Locale,
  entry: PaymentReturn | null,
): string | null {
  switch (action) {
    case "backToOrder":
    case "tryAgain":
      return entry === null ? null : returnOrderHref(locale, entry);
    case "signIn":
      return entry === null
        ? loginHref(locale, `/${locale}/account`)
        : loginHref(locale, accountOrderHref(locale, entry.number));
    case "home":
      return localizedHref(locale, "/");
    case "accountOrders":
      return accountOrdersHref(locale);
    case "checkAgain":
      return null;
  }
}

const ACTION_LABEL: Record<ReturnAction, string> = {
  backToOrder: "payment.return.backToOrder",
  tryAgain: "payment.return.tryAgain",
  checkAgain: "payment.return.checkAgain",
  signIn: "account.login.submit",
  home: "nav.home",
  accountOrders: "account.orders.title",
};

/** Border colour tokens by tone (the `Alert` of the UI library carries its own live role, which must not nest in the region). */
const TONE_BORDER = {
  info: "border-primary",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
} as const;

/**
 * The return page's content: one result region whose text is replaced as the watch moves on (it exists from the first render,
 * `aria-live="polite"`, so a screen reader announces each new state), a reserved height so the page does not jump, and the
 * next actions of the state. Pure: state in, markup out.
 */
export function PaymentReturnView({
  t,
  locale,
  state,
  entry,
  onCheckAgain,
}: PaymentReturnViewProps) {
  const view = returnPresentation(state);
  const payment = state !== "noEntry" && "payment" in state ? state.payment : null;
  const failure = state !== "noEntry" && state.phase === "error" ? state.failure : null;
  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold text-foreground">{t("payment.return.title")}</h1>
      <div
        id={RETURN_RESULT_ID}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={view.busy}
        tabIndex={-1}
        className="min-h-48 rounded-md outline-offset-2 focus:outline-2 focus:outline-ring"
      >
        <div
          className={`rounded-md border border-s-4 border-border bg-muted p-4 text-foreground ${TONE_BORDER[view.tone]}`}
        >
          <h2 className="flex items-center gap-3 font-semibold">
            {view.busy ? (
              <span
                aria-hidden="true"
                className="inline-block size-5 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none"
              />
            ) : null}
            {t(view.titleKey)}
          </h2>
          {view.bodyKey === null ? null : <p className="mt-2">{t(view.bodyKey)}</p>}
          {failure === null ? null : <p className="mt-2">{failureText(t, failure)}</p>}
          {entry === null ? null : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("payment.return.order", { number: entry.number })}
            </p>
          )}
          {payment === null ? null : (
            <p className="text-sm text-muted-foreground">
              {t("payment.return.orderStatus", { status: t(orderStatusKey(payment.orderStatus)) })}
            </p>
          )}
        </div>
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-3">
        {view.actions.map((action, index) => {
          const href = actionHref(action, locale, entry);
          if (action === "checkAgain") {
            return (
              <Button key={action} variant="secondary" onClick={onCheckAgain}>
                {t(ACTION_LABEL[action])}
              </Button>
            );
          }
          return href === null ? null : (
            <Link
              key={action}
              href={href}
              className={index === 0 ? linkButton : "underline underline-offset-4"}
            >
              {t(ACTION_LABEL[action])}
            </Link>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">{t("payment.return.contact")}</p>
    </Container>
  );
}

const LOADING: PaymentWatchState = { phase: "loading" };

/**
 * `/{locale}/payment/return?payment=<id>`. The query only says WHICH attempt; the order and (for a guest) the access token
 * come from this tab's hand-off (`payment-return.ts`), and everything shown comes from the status route. Without a hand-off
 * (another browser or device) the page says to open the order again. Polling is bounded (`payment-poll.ts`).
 */
export function PaymentReturnPage() {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const [entry, setEntry] = useState<PaymentReturn | null>(null);
  const [missing, setMissing] = useState(false);
  const [watch, setWatch] = useState<PaymentWatch | null>(null);
  const state = useSyncExternalStore(
    (listener) => watch?.subscribe(listener) ?? (() => {}),
    () => watch?.getState() ?? LOADING,
    () => LOADING,
  );

  useEffect(() => {
    const storage = sessionAttemptStorage(() => window.sessionStorage);
    const stored = readPaymentReturn(storage);
    if (stored === null) {
      setMissing(true);
      return;
    }
    // The query is a hint of WHICH attempt (a well-formed id, nothing else is read); the API checks it belongs to the order.
    const hint = paymentIdFromSearch(window.location.search);
    const known: PaymentReturn = hint === null ? stored : { ...stored, paymentId: hint };
    const created = createPaymentWatch({ read: statusReadFor(client, known) });
    setEntry(known);
    setWatch(created);
    created.start();
    return () => created.dispose();
  }, [client]);

  // The hand-off holds the guest's token only for the length of one payment trip: gone once the attempt is settled.
  useEffect(() => {
    if (state.phase === "final" || state.phase === "notFound") {
      clearPaymentReturn(sessionAttemptStorage(() => window.sessionStorage));
    }
  }, [state.phase]);

  return (
    <PaymentReturnView
      t={t}
      locale={locale}
      state={missing ? "noEntry" : state}
      entry={entry}
      onCheckAgain={() => {
        watch?.retry();
        // The button goes away with the retry: the result region takes the focus, so the keyboard stays where the news is.
        document.getElementById(RETURN_RESULT_ID)?.focus();
      }}
    />
  );
}
