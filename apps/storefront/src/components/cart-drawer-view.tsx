"use client";

import {
  Alert,
  Button,
  Drawer,
  Loader,
  textStyles,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import type { MouseEvent } from "react";
import {
  checkoutBlock,
  isCartBusy,
  isLineBusy,
  lineFlags,
  lineStockHint,
  stockHintText,
  stockProblemLines,
} from "../lib/cart-model";
import type { CartState, CartAnnouncement } from "../lib/cart-store";
import { failureText } from "../lib/failure";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import { CartDrawerQuantity, type DrawerQuantityProps } from "./cart-drawer-quantity";
import { StoreImage } from "./store-image";
import { focusRing, linkButton, secondaryLinkButton } from "./styles";

export interface CartDrawerViewProps {
  state: CartState;
  open: boolean;
  opener?: HTMLElement | null;
  onClose(): void;
  t: Translator;
  locale: Locale;
  exponent: number;
  imageHosts: readonly string[];
  onRetry(): void;
  onRemove(id: string): void;
  onAcknowledge(): void;
  onSetQuantity: DrawerQuantityProps["onSetQuantity"];
  registerLine: DrawerQuantityProps["registerLine"];
  onCheckout(event: MouseEvent<HTMLAnchorElement>): void;
  leaving?: boolean;
}
const announcements: Record<CartAnnouncement, string> = {
  updated: "cart.announce.updated",
  removed: "cart.announce.removed",
  cleared: "cart.announce.cleared",
  acknowledged: "cart.announce.acknowledged",
};

/** Pure cart presentation. Every displayed amount is a field from the latest server cart. */
export function CartDrawerView({
  state,
  open,
  opener,
  onClose,
  t,
  locale,
  exponent,
  imageHosts,
  onRetry,
  onRemove,
  onAcknowledge,
  onSetQuantity,
  registerLine,
  onCheckout,
  leaving = false,
}: CartDrawerViewProps) {
  const cart = state.cart;
  const block = cart === null ? "empty" : checkoutBlock(cart);
  const money = (value: Parameters<typeof formatMoney>[0]) => formatMoney(value, exponent, locale);
  return (
    <Drawer
      open={open}
      opener={opener}
      onClose={onClose}
      title={
        <>
          {t("cart.title")}
          {cart === null ? null : (
            <span className="ms-2 text-sm text-muted-foreground">
              {t.plural("cart.count", cart.itemCount)}
            </span>
          )}
        </>
      }
      closeLabel={t("cart.drawer.close")}
      footer={
        cart !== null && cart.lines.length > 0 ? (
          <div className="flex flex-col gap-3">
            <dl className="flex justify-between gap-3 tabular-nums">
              <dt>{t("cart.summary.subtotal")}</dt>
              <dd>{money(cart.subtotal)}</dd>
            </dl>
            <Link
              href={localizedHref(locale, "/cart")}
              className={`${secondaryLinkButton} w-full`}
              onClick={onClose}
            >
              {t("cart.drawer.viewCart")}
            </Link>
            {block === null ? (
              <Link
                href={localizedHref(locale, "/checkout")}
                className={`${linkButton} w-full`}
                aria-busy={leaving}
                aria-disabled={leaving || undefined}
                onClick={onCheckout}
              >
                {leaving ? t("cart.checkout.saving") : t("cart.checkout")}
              </Link>
            ) : (
              <>
                <Button disabled aria-describedby="drawer-checkout-reason">
                  {t("cart.checkout")}
                </Button>
                <p id="drawer-checkout-reason" className="text-sm">
                  {block === "stock"
                    ? t.plural("cart.checkout.stockBlockedShort", stockProblemLines(cart).length)
                    : t("cart.checkout.blocked")}
                </p>
              </>
            )}
          </div>
        ) : undefined
      }
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-sm text-muted-foreground"
      >
        {cart !== null && state.announcement !== null
          ? t(announcements[state.announcement], {
              count: cart.itemCount,
              total: money(cart.total),
            })
          : ""}
      </div>
      {state.failure === null ? null : (
        <Alert variant="danger">
          <p>{failureText(t, state.failure)}</p>
          {cart === null ? <Button onClick={onRetry}>{t("cart.retry")}</Button> : null}
        </Alert>
      )}
      {cart === null && state.status === "loading" ? (
        <div aria-busy="true">
          <Loader label={t("cart.loading")} />
        </div>
      ) : null}
      {cart !== null && cart.lines.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 96 96"
            className="size-24 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path className="fill-muted" d="m20 30 8 40h42l8-40Z" />
            <path d="M34 36V24a14 14 0 0 1 28 0v12M36 46v12m24-12v12" />
            <circle cx="36" cy="80" r="4" />
            <circle cx="62" cy="80" r="4" />
          </svg>
          <h3 className={textStyles.itemTitle}>{t("cart.empty.title")}</h3>
          <p>{t("cart.empty.description")}</p>
          <Link href={localizedHref(locale, "/catalog")} className={linkButton} onClick={onClose}>
            {t("cart.empty.action")}
          </Link>
        </div>
      ) : null}
      {cart !== null && cart.lines.length > 0 ? (
        <ul aria-label={t("cart.lines.label")} className="flex flex-col gap-6 py-4">
          {cart.lines.map((line) => {
            const flags = lineFlags(line);
            const stock = lineStockHint(line);
            return (
              <li
                key={line.variantId}
                className="fk-cart-line-enter flex flex-col gap-3 border-b border-border pb-4"
                aria-busy={isLineBusy(state, line.variantId)}
              >
                <div className="flex items-start gap-3">
                  <div className="w-20 shrink-0">
                    <StoreImage
                      src={allowedImageUrl(line.image?.url, imageHosts)}
                      alt={line.image?.alt ?? line.title}
                      width={96}
                      height={96}
                      sizes="80px"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={textStyles.itemTitle}>
                      <Link
                        href={localizedHref(locale, `/p/${encodeURIComponent(line.productSlug)}`)}
                        className={`font-semibold hover:underline ${focusRing}`}
                        onClick={onClose}
                      >
                        {line.title}
                      </Link>
                    </h3>
                    {line.variantTitle === null ? null : (
                      <p className="text-sm">{line.variantTitle}</p>
                    )}
                    {line.optionValues.map((choice) => (
                      <p key={choice.option} className="text-sm text-muted-foreground">
                        {t("cart.line.option", { option: choice.option, value: choice.value })}
                      </p>
                    ))}
                    {line.unitPrice === null ? null : (
                      <p className="text-sm tabular-nums">
                        {t("cart.line.unitPrice")} {money(line.unitPrice)}
                      </p>
                    )}
                  </div>
                </div>
                {flags.unavailable ? <p>{t("cart.notice.unavailable.hint")}</p> : null}
                {flags.outOfRange ? <p>{t("cart.notice.outOfRange.hint")}</p> : null}
                {flags.priceChanged === null ? null : (
                  <p className="text-sm">
                    {t("cart.notice.priceChanged")}
                    <Button
                      variant="secondary"
                      onClick={onAcknowledge}
                      disabled={isCartBusy(state)}
                    >
                      {t("cart.banner.ok")}
                    </Button>
                  </p>
                )}
                <div aria-live="polite">
                  {stock !== null ? (
                    <p className="text-sm">{stockHintText(t, stock)}</p>
                  ) : flags.outOfStock ? (
                    <p className="text-sm">{t("cart.notice.outOfStock.hint")}</p>
                  ) : line.availability === "low_stock" ? (
                    <p className="text-sm">{t("availability.low_stock")}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {flags.canEditQuantity ? (
                    <CartDrawerQuantity
                      line={line}
                      disabled={isCartBusy(state)}
                      t={t}
                      onSetQuantity={onSetQuantity}
                      registerLine={registerLine}
                    />
                  ) : (
                    <p>{t("cart.line.quantityFixed", { count: line.quantity })}</p>
                  )}
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    disabled={isLineBusy(state, line.variantId)}
                    aria-label={t("cart.line.remove", { title: line.title })}
                    onClick={() => onRemove(line.variantId)}
                  >
                    {t("cart.line.removeText")}
                  </Button>
                </div>
                {line.lineTotal === null ? null : (
                  <p className="text-end tabular-nums">
                    {t("cart.line.total")}{" "}
                    <span className="font-semibold">{money(line.lineTotal)}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Drawer>
  );
}
