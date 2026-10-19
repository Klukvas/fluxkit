"use client";

import type { OrderSummary } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Pagination,
  Skeleton,
  Spinner,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { formatDate } from "../lib/date";
import { failureText } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { accountOrderHref, accountOrdersHref, isOrderNumber } from "../lib/order-links";
import { orderMoney, orderStatusKey, parseOrdersPage, type ShopMoney } from "../lib/order-model";
import {
  accountOrderSource,
  createOrderListStore,
  createOrderStore,
  initialOrderState,
  type OrderListState,
  type OrderListStore,
  type OrderStore,
} from "../lib/order-store";
import { AccountGate } from "./account-gate";
import { OrderStatusView } from "./guest-order-page";
import { useI18n } from "./i18n-provider";
import { OrderDetailsView } from "./order-details";
import { useCancelFocus } from "./use-cancel-focus";
import { useAccount, useStoreClient } from "./session-provider";
import { focusRing, linkButton } from "./styles";

function OrderSummaryCard({
  order,
  t,
  locale,
  shop,
}: {
  order: OrderSummary;
  t: Translator;
  locale: Locale;
  shop: ShopMoney;
}) {
  return (
    <li>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">
            <Link
              href={accountOrderHref(locale, order.number)}
              className={`underline-offset-4 hover:underline ${focusRing}`}
            >
              {t("account.orders.number", { number: order.number })}
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("account.orders.placed", { date: formatDate(order.placedAt, locale) })}
          </p>
          <p className="text-sm text-foreground">
            {t.plural("account.orders.items", order.itemCount)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge>{t(orderStatusKey(order.status))}</Badge>
          <p className="font-semibold text-foreground">
            {t("account.orders.total", { total: orderMoney(order.total, shop, locale) })}
          </p>
        </div>
      </Card>
    </li>
  );
}

/** The order history of the signed-in customer, newest first, 24 per page (the API's order). */
export function AccountOrdersView({
  state,
  page,
  t,
  locale,
  shop,
  onRetry,
}: {
  state: OrderListState;
  page: number;
  t: Translator;
  locale: Locale;
  shop: ShopMoney;
  onRetry: () => void;
}) {
  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold text-foreground">{t("account.orders.title")}</h1>
      {state.status === "loading" || state.status === "signedOut" ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Spinner label={t("account.orders.loading")} />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="danger" title={t("account.orders.error")}>
          <p>{failureText(t, state.failure)}</p>
          <Button className="mt-3" onClick={onRetry}>
            {t("account.orders.retry")}
          </Button>
        </Alert>
      ) : null}
      {state.status === "outOfRange" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground">{t("account.orders.outOfRange")}</p>
          <Link href={accountOrdersHref(locale)} className={linkButton}>
            {t("account.orders.firstPage")}
          </Link>
        </div>
      ) : null}
      {state.status === "ready" && state.list.items.length === 0 ? (
        <EmptyState
          title={t("account.orders.empty.title")}
          description={t("account.orders.empty.description")}
          action={
            <Link href={localizedHref(locale, "/catalog")} className={linkButton}>
              {t("account.orders.empty.action")}
            </Link>
          }
        />
      ) : null}
      {state.status === "ready" && state.list.items.length > 0 ? (
        <>
          <ul aria-label={t("account.orders.list.label")} className="flex flex-col gap-3">
            {state.list.items.map((order) => (
              <OrderSummaryCard
                key={order.number}
                order={order}
                t={t}
                locale={locale}
                shop={shop}
              />
            ))}
          </ul>
          <Pagination
            label={t("account.orders.pagination.label")}
            currentPage={page}
            pageCount={state.pageCount}
            hrefForPage={(target) => accountOrdersHref(locale, target)}
            previousLabel={t("account.orders.pagination.previous")}
            nextLabel={t("account.orders.pagination.next")}
            pageLabel={(target) => t("account.orders.pagination.page", { page: target })}
          />
        </>
      ) : null}
      <Link href={localizedHref(locale, "/account")} className={`self-start ${focusRing}`}>
        {t("nav.account.account")}
      </Link>
    </Container>
  );
}

function OrderList({ shop }: { shop: ShopMoney }) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const { store: account } = useAccount();
  // A malformed or too large `?page` shows the "nothing on this page" state, never a silent page 1.
  const page = parseOrdersPage(useSearchParams().get("page"));
  const [store, setStore] = useState<OrderListStore | null>(null);
  const state = useSyncExternalStore<OrderListState>(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.getState() ?? { status: "loading" },
    () => ({ status: "loading" }),
  );

  useEffect(() => {
    if (page === null) return;
    const created = createOrderListStore({
      client,
      page,
      locale,
      onSignedOut: () => account.sessionEnded(),
    });
    setStore(created);
    void created.load();
  }, [client, page, locale, account]);

  return (
    <AccountOrdersView
      state={page === null ? { status: "outOfRange" } : state}
      page={page ?? 1}
      t={t}
      locale={locale}
      shop={shop}
      onRetry={() => void store?.load()}
    />
  );
}

/** `/{locale}/account/orders`, behind the account gate (a guest is sent to the sign-in page with this page as `next`). */
export function AccountOrders({ shop }: { shop: ShopMoney }) {
  return (
    <AccountGate titleKey="account.orders.title">
      {() => (
        <Suspense fallback={null}>
          <OrderList shop={shop} />
        </Suspense>
      )}
    </AccountGate>
  );
}

function OrderDetail({ number, shop }: { number: string; shop: ShopMoney }) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const { store: account } = useAccount();
  const [store, setStore] = useState<OrderStore | null>(null);
  const state = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.getState() ?? initialOrderState,
    () => initialOrderState,
  );
  useCancelFocus(state.cancel);

  const malformed = !isOrderNumber(number);

  useEffect(() => {
    // A number that cannot exist is the same not-found state, without a request.
    if (malformed) return;
    const created = createOrderStore({
      source: accountOrderSource(client, number, locale),
      onSignedOut: () => account.sessionEnded(),
    });
    setStore(created);
    void created.load();
  }, [client, number, locale, account, malformed]);

  return (
    <Container className="flex flex-col gap-6 py-8">
      {malformed ? (
        <OrderStatusView state={{ status: "notFound" }} t={t} locale={locale} onRetry={() => {}} />
      ) : state.load.status === "ready" && store !== null ? (
        <OrderDetailsView
          order={state.load.order}
          t={t}
          locale={locale}
          shop={shop}
          cancel={state.cancel}
          onAskCancel={() => store.askCancel()}
          onKeepOrder={() => store.keepOrder()}
          onConfirmCancel={() => void store.cancel()}
        />
      ) : (
        <OrderStatusView
          state={state.load.status === "ready" ? { status: "loading" } : state.load}
          t={t}
          locale={locale}
          onRetry={() => void store?.load()}
        />
      )}
      <Link href={accountOrdersHref(locale)} className={`self-start ${focusRing}`}>
        {t("account.orders.back")}
      </Link>
    </Container>
  );
}

/** `/{locale}/account/orders/{number}`: one own order, cancel while it awaits payment; another's is the same not-found. */
export function AccountOrder({ number, shop }: { number: string; shop: ShopMoney }) {
  return (
    <AccountGate titleKey="order.title">
      {() => <OrderDetail number={number} shop={shop} />}
    </AccountGate>
  );
}
