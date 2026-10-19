"use client";

import type { CartLine } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  PriceText,
  QuantityInput,
  Skeleton,
  Spinner,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from "../lib/add-to-cart";
import { cartPageHandlers } from "../lib/cart-handlers";
import {
  checkoutBlock,
  hasPriceChange,
  isCartBusy,
  isLineBusy,
  lineFlags,
  noticeMoney,
} from "../lib/cart-model";
import { LOAD_BUSY_KEY, type CartAnnouncement, type CartState } from "../lib/cart-store";
import { failureText } from "../lib/failure";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";
import { StoreImage } from "./store-image";
import { focusRing, linkButton } from "./styles";

export interface CartPageViewProps {
  state: CartState;
  t: Translator;
  locale: Locale;
  /** `currencyExponent` of the shop, from the server shell (`GET /store/config`). */
  exponent: number;
  /** `STOREFRONT_IMAGE_HOSTS` as the server sees it; a line image of any other host shows the placeholder. */
  imageHosts: readonly string[];
  onRetry: () => void;
  onSetQuantity: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
  onAcknowledge: () => void;
  onDismissFailure: () => void;
}

const ANNOUNCEMENT_KEYS: Record<CartAnnouncement, string> = {
  updated: "cart.announce.updated",
  removed: "cart.announce.removed",
  cleared: "cart.announce.cleared",
  acknowledged: "cart.announce.acknowledged",
};

/** The quantity box of one line: a typed number is a draft until the shopper submits it (one request, not one per key). */
export function QuantityFormView({
  title,
  draft,
  serverQuantity,
  busy,
  t,
  onDraftChange,
  onSubmit,
}: {
  title: string;
  draft: number;
  serverQuantity: number;
  busy: boolean;
  t: Translator;
  onDraftChange: (quantity: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-center gap-2">
      <QuantityInput
        label={t("cart.line.quantity", { title })}
        decreaseLabel={t("cart.line.decrease", { title })}
        increaseLabel={t("cart.line.increase", { title })}
        min={MIN_LINE_QUANTITY}
        max={MAX_LINE_QUANTITY}
        value={draft}
        onChange={onDraftChange}
        disabled={busy}
      />
      <Button type="submit" variant="secondary" disabled={busy || draft === serverQuantity}>
        {t("cart.line.update")}
      </Button>
    </form>
  );
}

function LineQuantity({
  line,
  busy,
  t,
  onSetQuantity,
}: {
  line: CartLine;
  busy: boolean;
  t: Translator;
  onSetQuantity: (variantId: string, quantity: number) => void;
}) {
  const [draft, setDraft] = useState(line.quantity);
  return (
    <QuantityFormView
      title={line.title}
      draft={draft}
      serverQuantity={line.quantity}
      busy={busy}
      t={t}
      onDraftChange={setDraft}
      onSubmit={(event) => {
        event.preventDefault();
        onSetQuantity(line.variantId, draft);
      }}
    />
  );
}

export function CartLineView({
  line,
  currency,
  busy,
  t,
  locale,
  exponent,
  imageHosts,
  onSetQuantity,
  onRemove,
}: {
  line: CartLine;
  currency: string;
  busy: boolean;
  t: Translator;
  locale: Locale;
  exponent: number;
  imageHosts: readonly string[];
  onSetQuantity: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
}) {
  const flags = lineFlags(line);
  const image = allowedImageUrl(line.image?.url, imageHosts);
  return (
    <li aria-busy={busy}>
      <Card className="flex gap-4 p-4">
        <div className="w-24 shrink-0">
          <StoreImage
            src={image}
            alt={line.image?.alt ?? line.title}
            width={96}
            height={96}
            sizes="96px"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            <Link
              href={localizedHref(locale, `/p/${encodeURIComponent(line.productSlug)}`)}
              className={`underline-offset-4 hover:underline ${focusRing}`}
            >
              {line.title}
            </Link>
          </h2>
          {line.variantTitle === null ? null : (
            <p className="text-sm text-muted-foreground">{line.variantTitle}</p>
          )}
          {line.optionValues.length === 0 ? null : (
            <ul className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              {line.optionValues.map((choice) => (
                <li key={choice.option}>
                  {t("cart.line.option", { option: choice.option, value: choice.value })}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">{t("product.sku", { sku: line.sku })}</p>

          {flags.priceChanged !== null && line.unitPrice !== null ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <Badge variant="warning">{t("cart.notice.priceChanged")}</Badge>
              <span>
                {t("cart.notice.priceChanged.detail", {
                  previous: noticeMoney(flags.priceChanged, currency, exponent, locale),
                  current: formatMoney(line.unitPrice, exponent, locale),
                })}
              </span>
            </p>
          ) : null}
          {flags.unavailable ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <Badge variant="danger">{t("cart.notice.unavailable")}</Badge>
              <span>{t("cart.notice.unavailable.hint")}</span>
            </p>
          ) : null}
          {flags.outOfStock ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <Badge variant="warning">{t("availability.out_of_stock")}</Badge>
              <span>{t("cart.notice.outOfStock.hint")}</span>
            </p>
          ) : null}
          {flags.outOfRange ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <Badge variant="danger">{t("cart.notice.outOfRange")}</Badge>
              <span>{t("cart.notice.outOfRange.hint")}</span>
            </p>
          ) : null}

          {line.unitPrice === null ? null : (
            <p className="text-foreground">
              <span className="text-sm text-muted-foreground">{t("cart.line.unitPrice")} </span>
              <PriceText price={formatMoney(line.unitPrice, exponent, locale)} />
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {flags.canEditQuantity ? (
              <LineQuantity
                // A new server quantity starts a new draft: the shopper always sees what the cart holds.
                key={line.quantity}
                line={line}
                busy={busy}
                t={t}
                onSetQuantity={onSetQuantity}
              />
            ) : (
              <p className="text-foreground">
                {t("cart.line.quantityFixed", { count: line.quantity })}
              </p>
            )}
            <Button
              variant="secondary"
              aria-label={t("cart.line.remove", { title: line.title })}
              disabled={busy}
              onClick={() => onRemove(line.variantId)}
            >
              {t("cart.line.removeText")}
            </Button>
          </div>
        </div>
        {line.lineTotal === null ? null : (
          <p className="shrink-0 text-end text-foreground">
            <span className="block text-sm text-muted-foreground">{t("cart.line.total")}</span>
            <PriceText price={formatMoney(line.lineTotal, exponent, locale)} />
          </p>
        )}
      </Card>
    </li>
  );
}

/**
 * The cart page: lines with their notices, the "prices changed" banner, the summary and the checkout link, or the loading,
 * error and empty states. Every number on it is the API's: amounts are only formatted here, never added or multiplied. A
 * live region (always mounted, so changes are announced) says what the last action did.
 */
export function CartPageView({
  state,
  t,
  locale,
  exponent,
  imageHosts,
  onRetry,
  onSetQuantity,
  onRemove,
  onAcknowledge,
  onDismissFailure,
}: CartPageViewProps) {
  const { cart, failure } = state;
  const announcement =
    cart !== null && state.announcement !== null
      ? t(ANNOUNCEMENT_KEYS[state.announcement], {
          count: cart.itemCount,
          total: formatMoney(cart.total, exponent, locale),
        })
      : "";
  const block = cart === null ? null : checkoutBlock(cart);
  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold text-foreground">{t("cart.title")}</h1>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-6 text-muted-foreground"
      >
        {announcement}
      </div>

      {cart !== null && failure !== null ? (
        <Alert variant="danger">
          <p>{failureText(t, failure)}</p>
          <Button variant="secondary" className="mt-3" onClick={onDismissFailure}>
            {t("cart.failure.dismiss")}
          </Button>
        </Alert>
      ) : null}

      {cart === null && state.status === "error" && failure !== null ? (
        <Alert variant="danger">
          <p>{failureText(t, failure)}</p>
          <Button className="mt-3" onClick={onRetry} disabled={state.busy.includes(LOAD_BUSY_KEY)}>
            {t("cart.retry")}
          </Button>
        </Alert>
      ) : null}

      {cart === null && state.status === "loading" ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Spinner label={t("cart.loading")} />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}

      {cart !== null && cart.lines.length === 0 ? (
        <EmptyState
          title={t("cart.empty.title")}
          description={t("cart.empty.description")}
          action={
            <Link href={localizedHref(locale, "/catalog")} className={linkButton}>
              {t("cart.empty.action")}
            </Link>
          }
        />
      ) : null}

      {cart !== null && cart.lines.length > 0 ? (
        <>
          {hasPriceChange(cart) ? (
            <Alert variant="warning" title={t("cart.banner.title")}>
              <p>{t("cart.banner.description")}</p>
              <Button className="mt-3" onClick={onAcknowledge} disabled={isCartBusy(state)}>
                {t("cart.banner.ok")}
              </Button>
            </Alert>
          ) : null}

          <ul aria-label={t("cart.lines.label")} className="flex flex-col gap-4">
            {cart.lines.map((line) => (
              <CartLineView
                key={line.variantId}
                line={line}
                currency={cart.subtotal.currency}
                busy={isLineBusy(state, line.variantId)}
                t={t}
                locale={locale}
                exponent={exponent}
                imageHosts={imageHosts}
                onSetQuantity={onSetQuantity}
                onRemove={onRemove}
              />
            ))}
          </ul>

          <section aria-labelledby="cart-summary-heading" className="flex flex-col gap-3">
            <h2 id="cart-summary-heading" className="text-xl font-semibold text-foreground">
              {t("cart.summary.title")}
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-foreground">
              <dt className="text-muted-foreground">{t("cart.summary.items")}</dt>
              <dd className="text-end">{t.plural("cart.count", cart.itemCount)}</dd>
              <dt className="text-muted-foreground">{t("cart.summary.subtotal")}</dt>
              <dd className="text-end">{formatMoney(cart.subtotal, exponent, locale)}</dd>
              <dt className="font-semibold">{t("cart.summary.total")}</dt>
              <dd className="text-end font-semibold">
                {formatMoney(cart.total, exponent, locale)}
              </dd>
            </dl>
            {block === null ? (
              <Link
                href={localizedHref(locale, "/checkout")}
                className={`${linkButton} self-start`}
              >
                {t("cart.checkout")}
              </Link>
            ) : (
              <>
                <Button className="self-start" disabled aria-describedby="cart-checkout-reason">
                  {t("cart.checkout")}
                </Button>
                <p id="cart-checkout-reason" className="text-sm text-muted-foreground">
                  {t("cart.checkout.blocked")}
                </p>
              </>
            )}
          </section>
        </>
      ) : null}
    </Container>
  );
}

/** The island of `/{locale}/cart`: reads and changes the shared cart store of the page (`SessionProvider`). */
export function CartPage({
  exponent,
  imageHosts,
}: {
  exponent: number;
  imageHosts: readonly string[];
}) {
  const { locale, t } = useI18n();
  const { state, store } = useCart();

  useEffect(() => {
    // Arriving by navigation, the cart may be older than the shopper expects: read it again. On a direct page load the
    // first read is still in flight (`loading`), and a second one would be the double fetch the shared store avoids.
    if (store.getState().status !== "loading") void store.refresh();
    return () => store.dismissFailure();
  }, [store]);

  return (
    <CartPageView
      state={state}
      t={t}
      locale={locale}
      exponent={exponent}
      imageHosts={imageHosts}
      {...cartPageHandlers(store)}
    />
  );
}
