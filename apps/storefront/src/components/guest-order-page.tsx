"use client";

import {
  Alert,
  Button,
  Container,
  Input,
  Skeleton,
  Spinner,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { failureText } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { guestOrderHref, isOrderNumber, tokenFromFragment } from "../lib/order-links";
import { paymentSection } from "../lib/payment-model";
import { guestPaySource, type PaySource } from "../lib/payment-store";
import type { ShopMoney } from "../lib/order-model";
import {
  createOrderStore,
  guestOrderSource,
  initialOrderState,
  type OrderState,
  type OrderStore,
} from "../lib/order-store";
import { useI18n } from "./i18n-provider";
import { OrderDetailsView } from "./order-details";
import { OrderPayment } from "./order-payment";
import { useCancelFocus } from "./use-cancel-focus";
import { useStoreClient } from "./session-provider";
import { linkButton } from "./styles";

/**
 * The states of an order page that are not the order itself: loading, the ONE not-found state (unknown number, a link
 * without a token or with a wrong or expired one, someone else's order: nothing tells them apart), and a retryable error.
 * Every state has one `h1`, also in the server HTML.
 */
export function OrderStatusView({
  state,
  t,
  locale,
  onRetry,
}: {
  state: Exclude<OrderState["load"], { status: "ready" }>;
  t: Translator;
  locale: Locale;
  onRetry: () => void;
}) {
  if (state.status === "notFound") {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-bold text-foreground">{t("order.notFound.title")}</h1>
        <p className="text-muted-foreground">{t("order.notFound.description")}</p>
        <Link href={localizedHref(locale, "/")} className={linkButton}>
          {t("nav.home")}
        </Link>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-bold text-foreground">{t("order.title")}</h1>
        <Alert variant="danger" title={t("order.error.title")}>
          <p>{failureText(t, state.failure)}</p>
        </Alert>
        <Button onClick={onRetry}>{t("order.retry")}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <h1 className="text-3xl font-bold text-foreground">{t("order.title")}</h1>
      <Spinner label={t("order.loading")} />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export type CopyState = "idle" | "copied" | "failed";

/**
 * "Save this link": the private link is the only way back to a guest order (until the email plan). The link is shown in a
 * read-only field (a visible fallback: it can always be selected and copied by hand) with a copy button for the Clipboard
 * API. It is rendered only in the browser, after the fragment was read; the server never has it.
 */
export function SaveLinkView({
  link,
  t,
  copy,
  onCopy,
}: {
  link: string;
  t: Translator;
  copy: CopyState;
  onCopy: () => void;
}) {
  return (
    <Alert variant="warning" title={t("order.saveLink.title")}>
      <p>{t("order.saveLink.description")}</p>
      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="order-link" className="font-medium text-foreground">
          {t("order.saveLink.label")}
        </label>
        <Input
          id="order-link"
          readOnly
          value={link}
          aria-describedby="order-link-copy-state"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button variant="secondary" className="self-start" onClick={onCopy}>
          {t("order.saveLink.copy")}
        </Button>
        <p id="order-link-copy-state" role="status" aria-live="polite" className="min-h-6 text-sm">
          {copy === "copied" ? t("order.saveLink.copied") : ""}
          {copy === "failed" ? t("order.saveLink.copyFailed") : ""}
        </p>
      </div>
    </Alert>
  );
}

/** Writes the link with the Clipboard API; `failed` when it is missing (an insecure context) or refused. */
export async function copyLink(
  link: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<CopyState> {
  if (clipboard === undefined) return "failed";
  try {
    await clipboard.writeText(link);
    return "copied";
  } catch {
    // Shown to the shopper (`order.saveLink.copyFailed`): the field stays selectable.
    return "failed";
  }
}

function useOrderState(store: OrderStore | null): OrderState {
  return useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.getState() ?? initialOrderState,
    () => initialOrderState,
  );
}

function Page({ children }: { children: ReactNode }) {
  return <Container className="flex flex-col gap-6 py-8">{children}</Container>;
}

/**
 * The guest order page (`/{locale}/order/{number}#t={token}`). The token is read from `location.hash` after hydration, so
 * it is never part of the server HTML; it goes into the POST body of the lookup and the cancel only (never a URL, a log,
 * the title or browser storage). The fragment is LEFT in the address bar (decision): it is what the shopper bookmarks
 * and what a reload needs, and a fragment never leaves the browser. The route sends `Referrer-Policy: no-referrer` and
 * loads nothing from another origin.
 */
export function GuestOrderPage({
  number,
  shop,
  onlinePayment = false,
}: {
  number: string;
  shop: ShopMoney;
  /** `onlinePayment` of `GET /store/config`: the shop takes payments online (the order's own `payment` says if this one can). */
  onlinePayment?: boolean;
}) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const [store, setStore] = useState<OrderStore | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // Holds the access token for the payment requests (their POST body), like the order store's source; never rendered.
  const [paySource, setPaySource] = useState<PaySource | null>(null);
  const [missing, setMissing] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const state = useOrderState(store);
  useCancelFocus(state.cancel);

  useEffect(() => {
    const token = tokenFromFragment(window.location.hash);
    if (token === null || !isOrderNumber(number)) {
      // No request without a well-formed number and token: the same not-found state as the API's 404.
      setMissing(true);
      return;
    }
    const created = createOrderStore({ source: guestOrderSource(client, number, token, locale) });
    setStore(created);
    setPaySource(guestPaySource(client, number, token, locale));
    setLink(`${window.location.origin}${guestOrderHref(locale, number, token)}`);
    void created.load();
  }, [client, number, locale]);

  if (missing) {
    return (
      <Page>
        <OrderStatusView state={{ status: "notFound" }} t={t} locale={locale} onRetry={() => {}} />
      </Page>
    );
  }
  if (state.load.status !== "ready" || store === null) {
    return (
      <Page>
        <OrderStatusView
          state={state.load.status === "ready" ? { status: "loading" } : state.load}
          t={t}
          locale={locale}
          onRetry={() => void store?.load()}
        />
      </Page>
    );
  }
  const payment = paymentSection(state.load.order, onlinePayment);
  return (
    <Page>
      {link === null ? null : (
        <SaveLinkView
          link={link}
          t={t}
          copy={copy}
          onCopy={() => {
            void copyLink(link, navigator.clipboard).then(setCopy);
          }}
        />
      )}
      <OrderDetailsView
        order={state.load.order}
        t={t}
        locale={locale}
        shop={shop}
        cancel={state.cancel}
        onAskCancel={() => store.askCancel()}
        onKeepOrder={() => store.keepOrder()}
        onConfirmCancel={() => void store.cancel()}
        payment={
          payment === null || paySource === null ? null : (
            <OrderPayment
              model={payment}
              orderExpiresAt={state.load.order.expiresAt}
              source={paySource}
              onOrderChanged={() => void store.load()}
            />
          )
        }
      />
    </Page>
  );
}
