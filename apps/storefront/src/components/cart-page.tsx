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
  textStyles,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from "../lib/add-to-cart";
import { cartPageHandlers } from "../lib/cart-handlers";
import { CheckoutSteps } from "./checkout-steps";
import { StoreTrustBar } from "./trust-bar";
import {
  cartLineAnchor,
  checkoutBlock,
  focusCartHeading,
  focusCheckoutReason,
  hasPriceChange,
  isCartBusy,
  isLineBusy,
  lineFlags,
  lineName,
  lineStockHint,
  noticeMoney,
  quantityStepperMax,
  stockHintText,
  stockProblemLines,
} from "../lib/cart-model";
import { LOAD_BUSY_KEY, type CartAnnouncement, type CartState } from "../lib/cart-store";
import { failureText, type Failure } from "../lib/failure";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import {
  createAutosaveRegistry,
  createQuantityAutosave,
  idleAutosave,
  type AutosaveState,
  type QuantityAutosave,
  type SaveOutcome,
} from "../lib/quantity-autosave";
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
  /** Resolves when the cart store applied the answer; a failure is returned to the line (not shown in the page alert). */
  onSetQuantity: (variantId: string, quantity: number, final: boolean) => Promise<SaveOutcome>;
  onRemove: (variantId: string) => void;
  onAcknowledge: () => void;
  onDismissFailure: () => void;
  /** Each line's autosave registers here, so the checkout link can wait for them (review M1 of PR 211). */
  registerLine?: (variantId: string, autosave: QuantityAutosave) => () => void;
  /** Checkout pressed while a quantity still saves: the link waits, shows it, and goes on once every line is saved. */
  onCheckout?: (event: MouseEvent<HTMLAnchorElement>) => void;
  leaving?: boolean;
  /** A quantity change sent after the shopper left the cart page was refused (shown when they come back). */
  leftFailure?: Failure | null;
  onDismissLeftFailure?: () => void;
}

/** The page heading; the focus lands here when the last line was removed (UX round 2, batch 3A item 5). */
const CART_HEADING_ID = "cart-heading";

/** Why the checkout button is blocked; the focus lands here when the checkout link turns into that button (review m5). */
const CHECKOUT_REASON_ID = "cart-checkout-reason";

const ANNOUNCEMENT_KEYS: Record<CartAnnouncement, string> = {
  updated: "cart.announce.updated",
  removed: "cart.announce.removed",
  cleared: "cart.announce.cleared",
  acknowledged: "cart.announce.acknowledged",
};

/**
 * The quantity of one line, saved by itself (no "Update" button, 2026-11-02): the number shows the shopper's choice at once,
 * "Saving..." while it waits for its delay or the server, and a refused change restores the server's quantity with the
 * reason next to it. Pure view; `LineQuantity` wires the autosave.
 */
export function LineQuantityView({
  title,
  variantId,
  quantity,
  autosave,
  disabled,
  t,
  onChange,
  stepMax = MAX_LINE_QUANTITY,
}: {
  title: string;
  variantId: string;
  /** The draft while one exists, else the server's quantity. */
  quantity: number;
  autosave: AutosaveState;
  /** A whole-cart write runs (the price-change OK) or the island is not ready: the quantity cannot change meanwhile. */
  disabled: boolean;
  t: Translator;
  onChange: (quantity: number) => void;
  /**
   * Where the step buttons stop (`quantityStepperMax`: the API's stock count when it gave one, else the line limit). A
   * typed number is limited to the line limit only: above the hint the server answers (review m1 of PR 215).
   */
  stepMax?: number;
}) {
  return (
    <div className="flex flex-col gap-1" aria-busy={autosave.pending}>
      <div className="flex flex-col gap-1">
        <QuantityInput
          label={t("cart.line.quantity", { title })}
          decreaseLabel={t("cart.line.decrease", { title })}
          increaseLabel={t("cart.line.increase", { title })}
          min={MIN_LINE_QUANTITY}
          max={MAX_LINE_QUANTITY}
          stepMax={stepMax}
          value={quantity}
          onChange={onChange}
          disabled={disabled}
        />
        {/* A reserved line, so the row does not move when the text appears. */}
        <span className="min-h-5 text-sm text-muted-foreground">
          {autosave.pending ? t("cart.line.saving") : ""}
        </span>
      </div>
      {autosave.failure === null ? null : (
        <p
          id={`cart-line-${variantId}-quantity-error`}
          role="alert"
          className="text-sm text-danger"
        >
          {t("cart.line.saveFailed", { reason: failureText(t, autosave.failure) })}
        </p>
      )}
    </div>
  );
}

function LineQuantity({
  line,
  disabled,
  t,
  onSetQuantity,
  registerLine,
}: {
  line: CartLine;
  disabled: boolean;
  t: Translator;
  registerLine: ((variantId: string, autosave: QuantityAutosave) => () => void) | undefined;
  onSetQuantity: (variantId: string, quantity: number, final: boolean) => Promise<SaveOutcome>;
}) {
  const serverQuantity = useRef(line.quantity);
  useEffect(() => {
    serverQuantity.current = line.quantity;
  }, [line.quantity]);
  const [autosave, setAutosave] = useState<QuantityAutosave | null>(null);
  const state = useSyncExternalStore(
    (listener) => autosave?.subscribe(listener) ?? (() => {}),
    () => autosave?.getState() ?? idleAutosave,
    () => idleAutosave,
  );
  const { variantId } = line;
  useEffect(() => {
    // Made in the effect (not in render), so React's strict double mount gets a fresh one after the first is disposed.
    const created = createQuantityAutosave({
      save: (quantity, final) => onSetQuantity(variantId, quantity, final),
      serverQuantity: () => serverQuantity.current,
    });
    setAutosave(created);
    const unregister = registerLine?.(variantId, created);
    return () => {
      unregister?.();
      // Leaving the page: nothing is lost. A waiting change is sent now, one made during a request after it; their
      // failure goes to the shared cart (`final`), since this line is gone.
      created.dispose();
    };
  }, [variantId, onSetQuantity, registerLine]);
  return (
    <LineQuantityView
      title={line.title}
      variantId={variantId}
      quantity={state.draft ?? line.quantity}
      autosave={state}
      disabled={disabled || autosave === null}
      t={t}
      onChange={(quantity) => autosave?.change(quantity)}
      stepMax={quantityStepperMax(line)}
    />
  );
}

export function CartLineView({
  line,
  currency,
  busy,
  cartBusy = false,
  t,
  locale,
  exponent,
  imageHosts,
  onSetQuantity,
  onRemove,
  registerLine,
}: {
  line: CartLine;
  currency: string;
  busy: boolean;
  /** A whole-cart write runs: the quantity cannot change meanwhile (a line's own save does not lock its stepper). */
  cartBusy?: boolean;
  t: Translator;
  locale: Locale;
  exponent: number;
  imageHosts: readonly string[];
  onSetQuantity: (variantId: string, quantity: number, final: boolean) => Promise<SaveOutcome>;
  onRemove: (variantId: string) => void;
  registerLine?: (variantId: string, autosave: QuantityAutosave) => () => void;
}) {
  const flags = lineFlags(line);
  const stock = lineStockHint(line);
  const image = allowedImageUrl(line.image?.url, imageHosts);
  return (
    <li id={cartLineAnchor(line.variantId)} aria-busy={busy}>
      {/* A stacked card (review D-09): picture and text, then one row of controls with the line total at its end. */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex gap-3 sm:gap-4">
          <div className="w-20 shrink-0 sm:w-24">
            <StoreImage
              src={image}
              alt={line.image?.alt ?? line.title}
              width={96}
              height={96}
              sizes="96px"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2 className={textStyles.subsectionTitle}>
              <Link
                href={localizedHref(locale, `/p/${encodeURIComponent(line.productSlug)}`)}
                className={`inline-flex min-h-6 items-center underline-offset-4 hover:underline ${focusRing}`}
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
            <p className="text-sm break-words text-muted-foreground">
              {t("product.sku", { sku: line.sku })}
            </p>

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
            {/* Always mounted, so a hint an autosave answer brings or clears is announced (review m5 of PR 215). */}
            <div aria-live="polite" aria-atomic="true" className="empty:-mt-2">
              {flags.outOfStock ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <Badge variant="warning">{t("availability.out_of_stock")}</Badge>
                  <span>
                    {stock === null ? t("cart.notice.outOfStock.hint") : stockHintText(t, stock)}
                  </span>
                </p>
              ) : stock !== null ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <Badge variant="warning">{t("cart.stock.badge")}</Badge>
                  <span>{stockHintText(t, stock)}</span>
                </p>
              ) : !flags.unavailable && line.availability === "low_stock" ? (
                <p className="text-sm text-foreground">
                  <Badge variant="warning">{t("availability.low_stock")}</Badge>
                </p>
              ) : null}
            </div>
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
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-start gap-3">
            {flags.canEditQuantity ? (
              <LineQuantity
                line={line}
                disabled={cartBusy}
                t={t}
                onSetQuantity={onSetQuantity}
                registerLine={registerLine}
              />
            ) : (
              <p className="text-foreground">
                {t("cart.line.quantityFixed", { count: line.quantity })}
              </p>
            )}
            <Button
              variant="secondary"
              className="min-h-11"
              aria-label={t("cart.line.remove", { title: line.title })}
              disabled={busy}
              onClick={() => onRemove(line.variantId)}
            >
              {t("cart.line.removeText")}
            </Button>
          </div>
          {line.lineTotal === null ? null : (
            <p className="ms-auto shrink-0 text-end text-foreground">
              <span className="block text-sm text-muted-foreground">{t("cart.line.total")}</span>
              <PriceText price={formatMoney(line.lineTotal, exponent, locale)} />
            </p>
          )}
        </div>
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
  registerLine,
  onCheckout,
  leaving = false,
  leftFailure = null,
  onDismissLeftFailure = () => {},
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
      {/* The funnel (review recommendation 3) once there is something to buy; an empty cart is not a step yet. */}
      {cart !== null && cart.lines.length > 0 ? (
        <CheckoutSteps t={t} locale={locale} current="cart" />
      ) : null}
      {/* Focusable by the script only: removing the last line moves the focus here (`focusCartHeading`). */}
      <h1 id={CART_HEADING_ID} tabIndex={-1} className={`${textStyles.pageTitle} ${focusRing}`}>
        {t("cart.title")}
      </h1>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-6 text-muted-foreground"
      >
        {announcement}
      </div>

      {leftFailure === null ? null : (
        <Alert variant="danger">
          <p>{t("cart.leftFailure", { reason: failureText(t, leftFailure) })}</p>
          <Button variant="secondary" className="mt-3" onClick={onDismissLeftFailure}>
            {t("cart.failure.dismiss")}
          </Button>
        </Alert>
      )}

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
          {/* Shaped like a line (image, text rows, the stepper), so the lines take the same room when they arrive. */}
          {[0, 1].map((index) => (
            <div key={index} className="flex gap-4 rounded-card border border-border p-4">
              <Skeleton className="h-24 w-24 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-11 w-48" />
              </div>
            </div>
          ))}
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
                cartBusy={isCartBusy(state)}
                t={t}
                locale={locale}
                exponent={exponent}
                imageHosts={imageHosts}
                onSetQuantity={onSetQuantity}
                onRemove={onRemove}
                registerLine={registerLine}
              />
            ))}
          </ul>

          <section aria-labelledby="cart-summary-heading" className="flex flex-col gap-3">
            <h2 id="cart-summary-heading" className={textStyles.sectionTitle}>
              {t("cart.summary.title")}
            </h2>
            {/* Tabular digits: the amounts change in place with every quantity change, and must not jiggle. */}
            <dl className="flex max-w-sm flex-col gap-1 text-foreground tabular-nums">
              <div className="flex justify-between gap-6">
                <dt className="text-muted-foreground">{t("cart.summary.items")}</dt>
                <dd>{t.plural("cart.count", cart.itemCount)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-muted-foreground">{t("cart.summary.subtotal")}</dt>
                <dd>{formatMoney(cart.subtotal, exponent, locale)}</dd>
              </div>
            </dl>
            {/* The full list of the lines that block the checkout stays in the page; the sticky bar below only counts them
                and links to the first, so it stays short on a phone (review M1 of PR 216). */}
            {block === "stock" ? (
              <div className="flex flex-col gap-1 text-sm">
                <p className="text-foreground">{t("cart.checkout.stockBlocked")}</p>
                <ul className="flex flex-col gap-1">
                  {stockProblemLines(cart).map((line) => (
                    <li key={line.variantId}>
                      <a
                        href={`#${cartLineAnchor(line.variantId)}`}
                        className={`inline-flex min-h-6 items-center text-foreground underline underline-offset-4 ${focusRing}`}
                      >
                        {lineName(line)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {/* The total and the checkout control stick to the bottom of a phone screen while the lines scroll (review D-09):
              CSS only, the same elements (a direct child of the page container, so `sticky` has the whole page to stick in). */}
          <div className="fk-sticky-bottom fk-bottom-bar flex flex-col gap-2 bg-background max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-4 max-md:border-t max-md:border-border max-md:px-4 max-md:pt-3 max-md:shadow-card">
            <dl className="flex max-w-sm flex-col text-foreground tabular-nums max-md:max-w-none">
              <div className="flex justify-between gap-6 font-semibold">
                <dt>{t("cart.summary.total")}</dt>
                <dd>{formatMoney(cart.total, exponent, locale)}</dd>
              </div>
            </dl>
            {/* The cart knows no delivery price (it depends on the address and the method chosen at checkout): say so next to the
                total instead of letting the checkout's delivery line come as a surprise (UX round 2, batch 3A item 1). */}
            <p id="cart-delivery-note" className="text-sm text-muted-foreground">
              {t("cartDelivery.note")}
            </p>
            {block === null ? (
              <Link
                href={localizedHref(locale, "/checkout")}
                className={`${linkButton} self-start max-md:self-stretch`}
                onClick={onCheckout}
                aria-busy={leaving}
                {...(leaving ? { "aria-disabled": true } : {})}
              >
                {leaving ? t("cart.checkout.saving") : t("cart.checkout")}
              </Link>
            ) : (
              <>
                <Button
                  className="min-h-11 self-start max-md:self-stretch"
                  disabled
                  aria-describedby={CHECKOUT_REASON_ID}
                >
                  {t("cart.checkout")}
                </Button>
                {block === "stock" ? (
                  <p
                    id={CHECKOUT_REASON_ID}
                    tabIndex={-1}
                    className={`flex flex-wrap items-center gap-x-2 text-sm text-foreground ${focusRing}`}
                  >
                    <span>
                      {t.plural("cart.checkout.stockBlockedShort", stockProblemLines(cart).length)}
                    </span>
                    {stockProblemLines(cart)
                      .slice(0, 1)
                      .map((line) => (
                        <a
                          key={line.variantId}
                          href={`#${cartLineAnchor(line.variantId)}`}
                          className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
                        >
                          {t("cart.checkout.firstLine")}
                        </a>
                      ))}
                  </p>
                ) : (
                  <p
                    id={CHECKOUT_REASON_ID}
                    tabIndex={-1}
                    className={`text-sm text-muted-foreground ${focusRing}`}
                  >
                    {t("cart.checkout.blocked")}
                  </p>
                )}
              </>
            )}
          </div>
          <StoreTrustBar t={t} locale={locale} className="max-w-sm max-md:max-w-none" />
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
  const router = useRouter();
  // Stable callbacks: each line's autosave is made once per line, not on every render.
  const handlers = useMemo(() => cartPageHandlers(store), [store]);
  const registry = useMemo(() => createAutosaveRegistry(), []);
  const [leaving, setLeaving] = useState(false);
  // A refusal of a quantity sent after the shopper left (review M1 of PR 211) lands in the shared cart's failure; the
  // read below would clear it, so it is kept here and shown until dismissed.
  const [leftFailure, setLeftFailure] = useState<Failure | null>(null);

  useEffect(() => {
    const before = store.getState();
    if (before.status !== "loading" && before.failure !== null) setLeftFailure(before.failure);
    // Arriving by navigation, the cart may be older than the shopper expects: read it again. On a direct page load the
    // first read is still in flight (`loading`), and a second one would be the double fetch the shared store avoids.
    if (before.status !== "loading") void store.refresh();
    return () => store.dismissFailure();
  }, [store]);

  // The checkout link turns into the blocked button when a save's answer flags a line (or empties nothing to order):
  // when that removed the focused link, the focus goes to the reason instead of the page body (review m5 of PR 215).
  const block = state.cart === null ? null : checkoutBlock(state.cart);
  const previousBlock = useRef(block);
  useEffect(() => {
    const before = previousBlock.current;
    previousBlock.current = block;
    const focusLost = document.activeElement === null || document.activeElement === document.body;
    if (focusCheckoutReason(before, block, focusLost)) {
      document.getElementById(CHECKOUT_REASON_ID)?.focus();
    }
  }, [block]);

  // Removing the last line removes its focused button with it, and the empty state has nothing focused: the focus goes to the
  // heading instead of the page body (UX round 2, batch 3A item 5). The live region above still says "removed".
  // Only after a remove pressed here: a cart another tab emptied moves no focus (review m7 of PR 234).
  const lineCount = state.cart === null ? null : state.cart.lines.length;
  const previousLineCount = useRef(lineCount);
  const removedHere = useRef(false);
  useEffect(() => {
    const before = previousLineCount.current;
    previousLineCount.current = lineCount;
    const focusLost = document.activeElement === null || document.activeElement === document.body;
    if (focusCartHeading(before, lineCount, focusLost, removedHere.current)) {
      document.getElementById(CART_HEADING_ID)?.focus();
    }
    if (before !== lineCount) removedHere.current = false;
  }, [lineCount]);

  async function checkoutWhenSaved(): Promise<void> {
    setLeaving(true);
    const saved = await registry.settled();
    setLeaving(false);
    // A refused quantity stays on this page with its reason on the line; the shopper decides again. So does a saved one
    // the server's answer flags for stock: the page now shows the reason and the checkout button is blocked.
    const cart = store.getState().cart;
    if (saved && cart !== null && checkoutBlock(cart) === null) {
      router.push(localizedHref(locale, "/checkout"));
    }
  }

  return (
    <CartPageView
      state={state}
      t={t}
      locale={locale}
      exponent={exponent}
      imageHosts={imageHosts}
      {...handlers}
      onRemove={(variantId) => {
        removedHere.current = true;
        handlers.onRemove(variantId);
      }}
      registerLine={registry.register}
      leaving={leaving}
      leftFailure={leftFailure}
      onDismissLeftFailure={() => setLeftFailure(null)}
      onCheckout={(event) => {
        // Nothing waits: an ordinary link. A quantity still saving: wait for it, so the checkout starts from it.
        if (!registry.pending() && !leaving) return;
        event.preventDefault();
        if (!leaving) void checkoutWhenSaved();
      }}
    />
  );
}
