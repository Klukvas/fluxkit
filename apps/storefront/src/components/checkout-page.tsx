"use client";

import type { Cart, CartLine } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Field,
  Select,
  Skeleton,
  Spinner,
  textStyles,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { checkoutConfig, type AddressFieldName, type CheckoutConfig } from "../config/checkout";
import { CheckoutSteps } from "./checkout-steps";
import { StoreTrustBar } from "./trust-bar";
import {
  cartLineAnchor,
  hasPriceChange,
  lineFlags,
  lineName,
  noticeMoney,
  stockHintText,
  stockProblemLines,
  stockProblems,
} from "../lib/cart-model";
import type { CartState } from "../lib/cart-store";
import {
  createAttemptManager,
  sessionAttemptStorage,
  webAttemptCrypto,
} from "../lib/checkout-attempt";
import {
  addressPath,
  checkoutFieldIds,
  checkoutFieldOrder,
  countryNames,
  countryOptions,
  initialCheckoutValues,
  prefillFromCustomer,
  requiredCheckoutFields,
  COUNTRY_FIELD,
  SHIPPING_CITY_FIELD,
  SHIPPING_CITY_NAME_FIELD,
  SHIPPING_METHOD_FIELD,
  SHIPPING_POINT_FIELD,
  SHIPPING_POINT_TEXT_FIELD,
  type CheckoutValues,
} from "../lib/checkout-form";
import {
  checkoutBlock,
  createCheckoutStore,
  initialCheckoutState,
  sameLines,
  type CheckoutBlock,
  type CheckoutState,
} from "../lib/checkout-store";
import {
  clearCheckoutDraft,
  loadCheckoutDraft,
  saveCheckoutDraft,
  browserCheckoutDraftStorage,
} from "../lib/checkout-draft";
import { clientFailure, failureText, type Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { LegalNotice, noticeLinks } from "./legal-notice";
import { formatMoney } from "../lib/money";
import { checkPhone, formatPhoneTyping, phoneFailure } from "../lib/phone";
import { loginHref } from "../lib/safe-next";
import {
  deliveryMode,
  deliveryPlan,
  initialShippingState,
  isDeliveryActive,
  countryToChoose,
  isOrderable,
  methodToChoose,
  servedCountries,
  type ShippingState,
} from "../lib/shipping-model";
import { createShippingStore } from "../lib/shipping-store";
import { shippingPriceText } from "../lib/shipping-text";
import { DeliverySectionView, PickupPointFields } from "./delivery-section";
import { FormErrorSummary, TextField, fieldMessage } from "./form-parts";
import { useI18n } from "./i18n-provider";
import { useAccount, useCart, useStoreClient } from "./session-provider";
import { focusRing, linkButton } from "./styles";
import { ChevronDownIcon } from "./icons";
import { useForm } from "./use-form";

/** `autocomplete` token of each address field (HTML autofill), so browsers and password managers fill the right box. */
const ADDRESS_AUTOCOMPLETE: Record<AddressFieldName, string> = {
  region: "address-level1",
  city: "address-level2",
  postalCode: "postal-code",
  line1: "address-line1",
  line2: "address-line2",
};

const BLOCK_KEYS: Record<Exclude<CheckoutBlock, "empty">, string> = {
  loading: "checkout.blocked.loading",
  notPurchasable: "checkout.blocked.notPurchasable",
  pricesChanged: "checkout.blocked.pricesChanged",
  confirmTotal: "checkout.blocked.confirmTotal",
  shippingLoading: "checkout.blocked.shippingLoading",
  shippingError: "checkout.blocked.shippingError",
  confirmShipping: "checkout.blocked.confirmShipping",
  shippingMethod: "checkout.blocked.shippingMethod",
};

export function checkoutLabels(t: Translator, config: CheckoutConfig): Record<string, string> {
  const labels: Record<string, string> = {
    email: t("checkout.field.email"),
    phone: t("checkout.field.phone"),
    firstName: t("checkout.field.firstName"),
    lastName: t("checkout.field.lastName"),
    [COUNTRY_FIELD]: t("checkout.field.countryCode"),
    shippingAddress: t("checkout.address.title"),
    [SHIPPING_METHOD_FIELD]: t("checkout.shipping.title"),
    [SHIPPING_CITY_FIELD]: t("checkout.shipping.city.label"),
    [SHIPPING_POINT_FIELD]: t("checkout.shipping.point.label"),
  };
  for (const field of config.addressFields) {
    const label = t(`checkout.field.${field.name}`);
    labels[addressPath(field.name)] = field.required
      ? label
      : t("checkout.field.optional", { label });
  }
  return labels;
}

/**
 * The phone field's next value: formatted (`formatPhoneTyping`) only when the caret is at the end and the change is not a
 * deletion there (typing at the end, or a paste that replaced the text), so deleting a space or editing in the middle never
 * fights the shopper or moves the caret; anything else is kept as typed.
 */
export function phoneTypingValue(
  previous: string,
  input: { value: string; selectionStart: number | null },
): string {
  const next = input.value;
  const atEnd = input.selectionStart === null || input.selectionStart === next.length;
  const deletedAtEnd = next.length < previous.length && previous.startsWith(next);
  return atEnd && next !== previous && !deletedAtEnd
    ? formatPhoneTyping(next, checkoutConfig.phoneDefaultCountry)
    : next;
}

/** The part of the order summary that collapses below `lg` (lines, totals, "Change the cart"). */
const SUMMARY_DETAILS_ID = "checkout-summary-details";

/** The stock warning's sentence: the submit button names it as its description while the warning is shown. */
const STOCK_WARNING_ID = "checkout-stock-warning";

/**
 * The lines the checkout would refuse for stock (the cart's `insufficientStock`, plan 2026-11-03; review SQ-02), shown as
 * soon as the page loads, above the form, so the shopper learns it before filling the form in: each line links to itself
 * in the cart with what to do (the count only when the API gives one). The submit stays enabled: the server judges the
 * order (a refusal names the lines and reads the cart again), and a hint can be older than the stock.
 */
export function StockWarningsView({
  cart,
  t,
  locale,
}: {
  cart: Cart;
  t: Translator;
  locale: Locale;
}) {
  const lines = stockProblems(cart);
  if (lines.length === 0) return null;
  return (
    <Alert variant="warning" title={t("checkout.stock.title")}>
      <p id={STOCK_WARNING_ID}>{t("checkout.stock.description")}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {lines.map(({ line, hint }) => (
          <li key={line.variantId} className="flex flex-wrap gap-x-2">
            <Link
              href={localizedHref(locale, `/cart#${cartLineAnchor(line.variantId)}`)}
              className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
            >
              {lineName(line)}
            </Link>
            <span>{stockHintText(t, hint)}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function SummaryLine({
  line,
  index,
  cart,
  refusal,
  t,
  locale,
  exponent,
}: {
  line: CartLine;
  index: number;
  cart: Cart;
  refusal: string | null;
  t: Translator;
  locale: Locale;
  exponent: number;
}) {
  const flags = lineFlags(line);
  const refusalId = `checkout-line-${String(index)}-refusal`;
  return (
    <li aria-describedby={refusal === null ? undefined : refusalId}>
      <Card className="flex flex-col gap-1 p-3">
        <div className="flex justify-between gap-4">
          <h3 className={textStyles.itemTitle}>{line.title}</h3>
          {line.lineTotal === null ? null : (
            <p className="shrink-0 text-foreground">
              {formatMoney(line.lineTotal, exponent, locale)}
            </p>
          )}
        </div>
        {line.optionValues.length === 0 ? null : (
          <ul className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            {line.optionValues.map((choice) => (
              <li key={choice.option}>
                {t("cart.line.option", { option: choice.option, value: choice.value })}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          {t("checkout.summary.quantity", { count: line.quantity })}
        </p>
        {flags.priceChanged !== null && line.unitPrice !== null ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <Badge variant="warning">{t("cart.notice.priceChanged")}</Badge>
            <span>
              {t("cart.notice.priceChanged.detail", {
                previous: noticeMoney(flags.priceChanged, cart.total.currency, exponent, locale),
                current: formatMoney(line.unitPrice, exponent, locale),
              })}
            </span>
          </p>
        ) : null}
        {flags.unavailable ? <Badge variant="danger">{t("cart.notice.unavailable")}</Badge> : null}
        {flags.outOfStock ? (
          <Badge variant="warning">{t("availability.out_of_stock")}</Badge>
        ) : null}
        {flags.outOfRange ? <Badge variant="danger">{t("cart.notice.outOfRange")}</Badge> : null}
        {refusal === null ? null : (
          <p id={refusalId} className="text-sm text-danger">
            {t("checkout.line.refused", { message: refusal })}
          </p>
        )}
      </Card>
    </li>
  );
}

export interface CheckoutPageViewProps {
  t: Translator;
  locale: Locale;
  exponent: number;
  /** The shop takes payments online: the payment note says so instead of "no payment is taken". */
  onlinePayment?: boolean;
  config: CheckoutConfig;
  cartState: CartState;
  checkout: CheckoutState;
  /** The shipping options of the cart (`GET /store/shipping/options`), as the shipping store holds them. */
  shipping: ShippingState;
  signedIn: boolean;
  values: CheckoutValues;
  failure: Failure | null;
  pending: boolean;
  summaryRef: Ref<HTMLDivElement>;
  /** Set after `too_many_open_orders` for a customer: a link to the order history. */
  ordersHref: string | null;
  signInHref: string;
  onValueChange: (path: string, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAcknowledge: () => void;
  onConfirmTotal: () => void;
  onConfirmShipping: () => void;
  onSelectMethod: (methodCode: string) => void;
  onRetryShipping: () => void;
  onRetryCart: () => void;
  /** The city and pickup point pickers of a pickup point method (they own the carrier lookups). */
  pickup: ReactNode;
  /**
   * Below `lg` the summary sits above the form, collapsed to one line until opened (mobile batch, review D-03). Absent: the
   * page decides (open while the server refused a line); a choice of the shopper wins, also after a refusal (review m2 of
   * PR 216).
   */
  summaryOpen?: boolean | undefined;
  onSummaryOpenChange?: (open: boolean) => void;
}

/**
 * The checkout page (plan step 7): contact form, the shipping address only when the cart `requiresShipping`, the order
 * summary from the cart response (formatted only, never added), the price-change and cart-changed confirmations that
 * block the submit, the payment wording (owner answer 9) and the submit with a busy state. Pure: the island passes state
 * and handlers in.
 */
export function CheckoutPageView(props: CheckoutPageViewProps) {
  const { t, locale, exponent, config, cartState, checkout, shipping, signedIn, values, failure } =
    props;
  const cart = cartState.cart;

  if (cart === null && cartState.status === "error") {
    return (
      <Container className="flex flex-col items-start gap-4 py-8">
        <h1 className={textStyles.pageTitle}>{t("checkout.title")}</h1>
        <Alert variant="danger" title={t("checkout.loadError")}>
          {cartState.failure === null ? null : <p>{failureText(t, cartState.failure)}</p>}
        </Alert>
        <Button onClick={props.onRetryCart}>{t("checkout.retry")}</Button>
      </Container>
    );
  }
  if (cart === null) {
    return (
      <Container className="flex flex-col gap-4 py-8" aria-busy="true">
        <h1 className={textStyles.pageTitle}>{t("checkout.title")}</h1>
        <Spinner label={t("checkout.loading")} />
        <Skeleton className="h-48 w-full" />
      </Container>
    );
  }
  if (cart.lines.length === 0) {
    return (
      <Container className="flex flex-col gap-6 py-8">
        <h1 className={textStyles.pageTitle}>{t("checkout.title")}</h1>
        <EmptyState
          title={t("checkout.empty.title")}
          description={t("checkout.empty.description")}
          action={
            <Link href={localizedHref(locale, "/catalog")} className={linkButton}>
              {t("checkout.empty.action")}
            </Link>
          }
        />
      </Container>
    );
  }

  const methodCode = values[SHIPPING_METHOD_FIELD] ?? "";
  const plan = deliveryPlan(cart, shipping, methodCode);
  const mode = deliveryMode(cart, shipping, methodCode);
  const block = checkoutBlock(cart, checkout, plan);
  const requiresShipping = cart.requiresShipping;
  const deliveryActive = isDeliveryActive(cart, shipping);
  const deliveryOptions = shipping.answer?.options ?? [];
  // Until the first answer (or its failure) we do not know whether the shop has methods: show neither form.
  const deliveryUnknown = requiresShipping && shipping.answer === null && shipping.failure === null;
  // The chosen option for DISPLAY, also while a newer read runs (no flicker); only the submit waits for the new price.
  const shownOption = deliveryOptions.find((option) => option.methodCode === methodCode);
  const shown = isOrderable(shownOption) ? shownOption : null;
  const money = (value: Parameters<typeof formatMoney>[0]) => formatMoney(value, exponent, locale);
  // The total of the cart without any delivery. With delivery in the shop the order total is the option's (below).
  const itemsTotal = deliveryActive ? cart.subtotal : cart.total;
  const labels = checkoutLabels(t, config);
  const ids = checkoutFieldIds(config);
  const refusals =
    checkout.lineErrors !== null && sameLines(checkout.lineErrors.cart, cart)
      ? checkout.lineErrors.errors
      : [];
  const submitDisabled = props.pending || block !== null || checkout.insecure;
  const totalText = !deliveryActive
    ? money(cart.total)
    : shown === null
      ? t("checkout.summary.total.pending")
      : money(shown.total);
  // A line the server refused is shown open, right under the alerts at the top.
  const summaryShown = props.summaryOpen ?? refusals.length > 0;
  const field = (path: string) => ({
    id: ids[path] as string,
    name: path,
    label: labels[path] as string,
    failure,
    t,
    value: values[path] ?? "",
    onValueChange: (value: string) => props.onValueChange(path, value),
  });
  const countryError =
    fieldMessage(failure, COUNTRY_FIELD, t) ?? fieldMessage(failure, "shippingAddress", t);

  return (
    <Container className="flex flex-col gap-6 py-8">
      <CheckoutSteps t={t} locale={locale} current="checkout" />
      <h1 className={textStyles.pageTitle}>{t("checkout.title")}</h1>

      {checkout.insecure ? (
        <Alert variant="danger">{t("checkout.error.insecureContext")}</Alert>
      ) : null}
      {checkout.attemptPersistent ? null : (
        <Alert variant="warning">{t("checkout.warning.storage")}</Alert>
      )}
      {signedIn ? null : (
        <p className="text-foreground">
          {t("checkout.signInPrompt")}{" "}
          <Link
            href={props.signInHref}
            className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
          >
            {t("checkout.signIn")}
          </Link>
        </p>
      )}
      <StockWarningsView cart={cart} t={t} locale={locale} />

      <div className="grid gap-8 lg:grid-cols-3">
        {/* First in the page order: above the form on phones; from `lg` placed in the right column as before. */}
        <section
          aria-labelledby="checkout-summary-heading"
          className="flex flex-col gap-4 lg:col-start-3 lg:row-start-1"
        >
          <h2 id="checkout-summary-heading" className={`${textStyles.sectionTitle} max-lg:hidden`}>
            {t("checkout.summary.title")}
          </h2>
          <h2 className="lg:hidden">
            <button
              type="button"
              aria-expanded={summaryShown}
              aria-controls={SUMMARY_DETAILS_ID}
              onClick={() => props.onSummaryOpenChange?.(!summaryShown)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-md border border-border bg-muted px-4 py-2 text-start text-foreground ${focusRing}`}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{t("checkout.summary.title")}</span>
                <span className="text-sm text-muted-foreground">
                  {t("checkout.summary.toggleDetail", {
                    items: t.plural("cart.count", cart.itemCount),
                    total: totalText,
                  })}
                </span>
              </span>
              <ChevronDownIcon
                className={`shrink-0 motion-safe:transition-transform ${summaryShown ? "rotate-180" : ""}`}
              />
            </button>
          </h2>
          {hasPriceChange(cart) ? (
            <Alert variant="warning" title={t("cart.banner.title")}>
              <p>{t("cart.banner.description")}</p>
              <Button className="mt-3" onClick={props.onAcknowledge}>
                {t("cart.banner.ok")}
              </Button>
            </Alert>
          ) : null}
          {block === "confirmTotal" ? (
            <Alert variant="warning" title={t("checkout.confirm.title")}>
              <p>
                {t("checkout.confirm.total", {
                  total: money(plan.kind === "ship" ? plan.total : itemsTotal),
                })}
              </p>
              <Button className="mt-3" onClick={props.onConfirmTotal}>
                {t("checkout.confirm.button")}
              </Button>
            </Alert>
          ) : null}
          {block === "confirmShipping" &&
          plan.kind === "ship" &&
          checkout.shippingConsent !== null ? (
            <Alert variant="warning" title={t("checkout.shippingChanged.title")}>
              <p>
                {t("checkout.shippingChanged.body", {
                  method: plan.option.title,
                  price: shippingPriceText(t, plan.option, money),
                  total: money(plan.total),
                  previousTotal: money(checkout.shippingConsent.previousTotal),
                })}
              </p>
              <Button className="mt-3" onClick={props.onConfirmShipping}>
                {t("checkout.shippingChanged.button")}
              </Button>
            </Alert>
          ) : null}
          {checkout.shippingConsent !== null &&
          plan.kind === "blocked" &&
          plan.reason === "unavailable" ? (
            <Alert variant="warning" title={t("checkout.shippingChanged.title")}>
              <p>
                {t("checkout.shippingChanged.unavailable", {
                  method:
                    deliveryOptions.find(
                      (option) => option.methodCode === checkout.shippingConsent?.methodCode,
                    )?.title ?? checkout.shippingConsent.methodCode,
                })}
              </p>
            </Alert>
          ) : null}
          {block === "notPurchasable" ? (
            <Alert variant="danger">
              <p>{t("checkout.blocked.notPurchasable")}</p>
            </Alert>
          ) : null}
          <div
            id={SUMMARY_DETAILS_ID}
            className={`flex flex-col gap-4${summaryShown ? "" : " max-lg:hidden"}`}
          >
            <ul aria-label={t("checkout.summary.lines.label")} className="flex flex-col gap-2">
              {cart.lines.map((line, index) => {
                const refusal = refusals.find((error) => error.index === index);
                return (
                  <SummaryLine
                    key={line.variantId}
                    line={line}
                    index={index}
                    cart={cart}
                    refusal={refusal === undefined ? null : t(refusal.messageKey)}
                    t={t}
                    locale={locale}
                    exponent={exponent}
                  />
                );
              })}
            </ul>
            <dl className="flex flex-col gap-1 text-foreground">
              <div className="flex justify-between gap-6">
                <dt className="text-muted-foreground">{t("cart.summary.items")}</dt>
                <dd>{t.plural("cart.count", cart.itemCount)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-muted-foreground">{t("cart.summary.subtotal")}</dt>
                <dd>
                  {money(
                    deliveryActive && shipping.answer !== null
                      ? shipping.answer.subtotal
                      : cart.subtotal,
                  )}
                </dd>
              </div>
              {deliveryActive ? (
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">{t("checkout.summary.shipping")}</dt>
                  <dd className="text-end">
                    {shown === null
                      ? t("checkout.summary.shipping.notChosen")
                      : shippingPriceText(t, shown, money)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-6 font-semibold">
                <dt>{t("cart.summary.total")}</dt>
                <dd className="text-end">{totalText}</dd>
              </div>
            </dl>
            <Link
              href={localizedHref(locale, "/cart")}
              className={`self-start underline underline-offset-4 ${focusRing}`}
            >
              {t("checkout.summary.editCart")}
            </Link>
            <StoreTrustBar t={t} locale={locale} />
          </div>
        </section>
        <form
          method="post"
          onSubmit={props.onSubmit}
          noValidate
          aria-busy={props.pending}
          className="flex flex-col gap-6 lg:col-span-2 lg:col-start-1 lg:row-start-1"
        >
          <FormErrorSummary
            failure={failure}
            t={t}
            labels={labels}
            ids={ids}
            summaryRef={props.summaryRef}
          />
          {props.ordersHref === null ? null : (
            <Link href={props.ordersHref} className={`self-start ${linkButton}`}>
              {t("checkout.tooManyOpenOrders.link")}
            </Link>
          )}

          <fieldset className="flex flex-col gap-4">
            <legend className={`${textStyles.sectionTitle} mb-2`}>
              <h2>{t("checkout.contact.title")}</h2>
            </legend>
            <TextField
              {...field("email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              required={!signedIn}
              {...(signedIn ? { hint: t("checkout.field.email.hintCustomer") } : {})}
            />
            <TextField
              {...field("phone")}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              hint={t("checkout.field.phone.hint")}
              onValueChange={(value, input) =>
                props.onValueChange(
                  "phone",
                  phoneTypingValue(values["phone"] ?? "", {
                    value,
                    selectionStart: input.selectionStart,
                  }),
                )
              }
            />
            <TextField {...field("firstName")} autoComplete="given-name" maxLength={100} />
            <TextField {...field("lastName")} autoComplete="family-name" maxLength={100} />
          </fieldset>

          {deliveryUnknown ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <h2 className={textStyles.sectionTitle}>{t("checkout.shipping.title")}</h2>
              <Spinner label={t("checkout.shipping.loading")} />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}
          {requiresShipping && (deliveryActive || shipping.failure !== null) ? (
            <DeliverySectionView
              t={t}
              locale={locale}
              exponent={exponent}
              shipping={shipping}
              options={deliveryOptions}
              methodCode={methodCode}
              methodId={ids[SHIPPING_METHOD_FIELD] as string}
              failure={failure}
              onSelectMethod={props.onSelectMethod}
              onRetry={props.onRetryShipping}
              pickup={props.pickup}
            />
          ) : null}
          {requiresShipping && !deliveryUnknown && (mode === "none" || mode === "address") ? (
            <fieldset className="flex flex-col gap-4">
              <legend className={`${textStyles.sectionTitle} mb-2`}>
                <h2>{t("checkout.address.title")}</h2>
              </legend>
              <Field
                id={ids[COUNTRY_FIELD] as string}
                label={labels[COUNTRY_FIELD]}
                required
                {...(countryError === undefined ? {} : { error: countryError })}
              >
                {(control) => (
                  <Select
                    {...control}
                    name={COUNTRY_FIELD}
                    autoComplete="country"
                    value={values[COUNTRY_FIELD] ?? ""}
                    onChange={(event) =>
                      props.onValueChange(COUNTRY_FIELD, event.currentTarget.value)
                    }
                  >
                    {(deliveryActive
                      ? countryNames(servedCountries(deliveryOptions), locale)
                      : countryOptions(config, locale)
                    ).map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {config.addressFields.map((address) => (
                <TextField
                  key={address.name}
                  {...field(addressPath(address.name))}
                  autoComplete={ADDRESS_AUTOCOMPLETE[address.name]}
                  required={address.required}
                  maxLength={200}
                />
              ))}
            </fieldset>
          ) : null}
          {requiresShipping ? null : (
            <p className="text-muted-foreground">{t("checkout.address.none")}</p>
          )}

          <section aria-labelledby="checkout-payment-heading" className="flex flex-col gap-2">
            <h2 id="checkout-payment-heading" className={textStyles.sectionTitle}>
              {t("checkout.payment.title")}
            </h2>
            <p className="text-foreground">
              {t(
                props.onlinePayment === true
                  ? "checkout.payment.noteOnline"
                  : "checkout.payment.note",
              )}
            </p>
          </section>

          <LegalNotice t={t} kind="checkout" links={noticeLinks(locale)} />
          {/* "Place order" with the total sticks to the bottom of a phone screen (review D-03): a direct child of the form,
              so it stays while any field is in view; the scroll padding keeps a focused field above it. */}
          <div className="fk-sticky-bottom fk-bottom-bar flex flex-col gap-2 bg-background max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:-mx-4 max-lg:border-t max-lg:border-border max-lg:px-4 max-lg:pt-3 max-lg:shadow-card">
            <p className="flex justify-between gap-6 font-semibold text-foreground lg:hidden">
              <span>{t("cart.summary.total")}</span>
              <span className="text-end">{totalText}</span>
            </p>
            <Button
              type="submit"
              className="min-h-11 self-start max-lg:min-h-12 max-lg:self-stretch"
              disabled={submitDisabled}
              aria-busy={props.pending}
              {...(block !== null
                ? { "aria-describedby": "checkout-blocked-reason" }
                : stockProblemLines(cart).length > 0
                  ? { "aria-describedby": STOCK_WARNING_ID }
                  : {})}
            >
              {props.pending ? t("checkout.submitting") : t("checkout.submit")}
            </Button>
            {block === null || block === "empty" ? null : (
              <p id="checkout-blocked-reason" className="text-sm text-muted-foreground">
                {t(BLOCK_KEYS[block])}
              </p>
            )}
          </div>
        </form>
      </div>
    </Container>
  );
}

/**
 * The island of `/{locale}/checkout`. The cart is the page's shared cart store; the checkout store sends the order. The
 * form values live in component state and, as a draft of this tab, in `sessionStorage` (`lib/checkout-draft.ts`: one hour,
 * removed when the order is placed and on sign-out; never a URL or a log); the attempt in `sessionStorage` is a key and a hash.
 */
export function CheckoutPage({
  exponent,
  onlinePayment = false,
}: {
  exponent: number;
  onlinePayment?: boolean;
}) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const { state: cartState, store: cartStore } = useCart();
  const { state: account } = useAccount();
  const router = useRouter();
  const [shipping] = useState(() => createShippingStore({ client, cart: cartStore, locale }));
  // `undefined` until the shopper toggles it: then the page decides (open for a refused line).
  const [summaryOpen, setSummaryOpen] = useState<boolean | undefined>(undefined);
  const shippingState = useSyncExternalStore(
    shipping.subscribe,
    shipping.getState,
    () => initialShippingState,
  );
  const [checkout] = useState(() =>
    createCheckoutStore({
      client,
      cart: cartStore,
      shipping,
      locale,
      config: checkoutConfig,
      attempts: () =>
        createAttemptManager({
          storage: sessionAttemptStorage(() => window.sessionStorage),
          crypto: webAttemptCrypto(globalThis.crypto),
        }),
    }),
  );
  const checkoutState = useSyncExternalStore(
    checkout.subscribe,
    checkout.getState,
    () => initialCheckoutState,
  );
  const [ordersHref, setOrdersHref] = useState<string | null>(null);
  const signedIn = account.session.status === "signedIn";
  // A new refusal opens the summary again, even after the shopper closed it for an earlier one.
  const lineErrors = checkoutState.lineErrors;
  useEffect(() => {
    if (lineErrors !== null) setSummaryOpen(undefined);
  }, [lineErrors]);
  const cart = cartState.cart;
  const requiresShipping = cart?.requiresShipping ?? true;
  const fieldIds = useMemo(() => checkoutFieldIds(checkoutConfig), []);
  // The chosen method is kept beside the form values (the form's field order depends on it) and joined to them below.
  const [methodCode, setMethodCode] = useState("");
  const mode = cart === null ? "none" : deliveryMode(cart, shippingState, methodCode);
  const fieldOrder = useMemo(
    () => checkoutFieldOrder(requiresShipping, checkoutConfig, mode),
    [requiresShipping, mode],
  );
  const form = useForm<CheckoutValues>({
    initial: initialCheckoutValues(checkoutConfig),
    fieldOrder,
    fieldIds,
  });
  const values = useMemo(
    () => ({ ...form.values, [SHIPPING_METHOD_FIELD]: methodCode }),
    [form.values, methodCode],
  );
  const prefilled = useRef(false);
  const { setValues } = form;

  // The draft of this tab (review SQ-05): restored once after hydration (the server never sees it), then kept up to date,
  // so the language switch (a full page load) and a reload do not wipe what the shopper typed. Restored BEFORE the
  // account prefill, which fills only the fields that are still empty.
  const [draftStorage] = useState(() => browserCheckoutDraftStorage());
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    const draft = loadCheckoutDraft(draftStorage, Date.now());
    if (draft !== null) {
      setValues((current) => ({ ...current, ...draft.values }));
      setMethodCode(draft.methodCode);
    }
    setDraftRestored(true);
  }, [draftStorage, setValues]);
  useEffect(() => {
    if (!draftRestored) return;
    saveCheckoutDraft(draftStorage, { values: form.values, methodCode }, Date.now());
  }, [draftRestored, draftStorage, form.values, methodCode]);

  useEffect(() => {
    checkout.prepare();
    // Opened by navigation, the cart may be old: read it again (a direct load's first read is still in flight).
    if (cartStore.getState().status !== "loading") void cartStore.refresh();
  }, [checkout, cartStore]);

  // The delivery options depend on the destination the shopper typed and on the pickup point they chose (for the carrier's
  // estimate). A cart change is followed by the shipping store itself.
  const wantsDelivery = cart !== null && cart.lines.length > 0 && cart.requiresShipping;
  const country = form.values[COUNTRY_FIELD] ?? "";
  const cityRef = form.values[SHIPPING_CITY_FIELD] ?? "";
  const pointRef = form.values[SHIPPING_POINT_FIELD] ?? "";
  useEffect(() => {
    if (!wantsDelivery) return;
    void shipping.read({ country, cityRef, pickupPointRef: pointRef });
  }, [shipping, wantsDelivery, country, cityRef, pointRef]);
  useEffect(() => () => shipping.dispose(), [shipping]);

  // A new answer: choose the first available method when none is chosen, and a country some method serves.
  const answer = shippingState.answer;
  useEffect(() => {
    if (answer === null) return;
    setMethodCode((current) => methodToChoose(answer.options, current) ?? current);
    setValues((current) => {
      const next = countryToChoose(
        answer.options,
        current[COUNTRY_FIELD] ?? "",
        checkoutConfig.defaultCountry,
      );
      return next === null ? current : { ...current, [COUNTRY_FIELD]: next };
    });
  }, [answer, setValues]);

  useEffect(() => {
    if (!draftRestored || account.session.status !== "signedIn" || prefilled.current) return;
    prefilled.current = true;
    const { customer } = account.session;
    setValues((current) =>
      prefillFromCustomer(current, customer, checkoutConfig.phoneDefaultCountry),
    );
  }, [draftRestored, account.session, setValues]);

  const chosen = answer?.options.find((option) => option.methodCode === methodCode);

  return (
    <CheckoutPageView
      summaryOpen={summaryOpen}
      onSummaryOpenChange={setSummaryOpen}
      t={t}
      locale={locale}
      exponent={exponent}
      onlinePayment={onlinePayment}
      config={checkoutConfig}
      cartState={cartState}
      checkout={checkoutState}
      shipping={shippingState}
      signedIn={signedIn}
      values={values}
      failure={form.failure}
      pending={form.pending || checkoutState.pending}
      summaryRef={form.summaryRef}
      ordersHref={ordersHref}
      signInHref={loginHref(locale, `/${locale}/checkout`)}
      pickup={
        chosen?.providerCode == null ? null : (
          <PickupPointFields
            // A new method (maybe another carrier) starts its pickers over.
            key={chosen.methodCode}
            t={t}
            locale={locale}
            providerCode={chosen.providerCode}
            values={values}
            failure={form.failure}
            ids={fieldIds}
            onValueChange={form.setValue}
          />
        )
      }
      onValueChange={form.setValue}
      onSelectMethod={(code) => {
        if (code === methodCode) return;
        checkout.forgetShippingConsent();
        // The city and the point belong to the method (and its carrier): a new method starts without them.
        setMethodCode(code);
        setValues((current) => ({
          ...current,
          [SHIPPING_CITY_FIELD]: "",
          [SHIPPING_CITY_NAME_FIELD]: "",
          [SHIPPING_POINT_FIELD]: "",
          [SHIPPING_POINT_TEXT_FIELD]: "",
        }));
      }}
      onAcknowledge={() => void checkout.acknowledge()}
      onConfirmTotal={() => checkout.confirmTotal()}
      onConfirmShipping={() => checkout.confirmShipping()}
      onRetryShipping={() => void shipping.refresh()}
      onRetryCart={() => void cartStore.refresh()}
      onSubmit={(event) =>
        form.submit(event, {
          required: requiredCheckoutFields(
            { signedIn, requiresShipping, delivery: mode },
            checkoutConfig,
          ),
          leaves: true,
          check: (submitted) => {
            const text = submitted["phone"] ?? "";
            if (text.trim() === "") return null; // reported as a blank required field
            const phone = checkPhone(text, checkoutConfig.phoneDefaultCountry);
            return phone.ok ? null : phoneFailure("phone", phone.problem);
          },
          run: async (submitted) => {
            setOrdersHref(null);
            // The phone is checked here (friendly per-field texts) and sent as E.164; the API still judges it.
            const phone = checkPhone(submitted["phone"] ?? "", checkoutConfig.phoneDefaultCountry);
            if (!phone.ok) return phoneFailure("phone", phone.problem);
            const result = await checkout.submit(
              { ...submitted, phone: phone.e164, [SHIPPING_METHOD_FIELD]: methodCode },
              { signedIn },
            );
            if (result.kind === "placed" || result.kind === "cartEmpty") {
              // The order exists (or there is nothing to order): the typed contact and address are not kept any longer.
              clearCheckoutDraft(draftStorage);
              router.replace(result.href);
              return null;
            }
            if (result.kind === "blocked") {
              return clientFailure(
                result.reason === "empty" ? "errors.cart_empty" : BLOCK_KEYS[result.reason],
              );
            }
            if (result.kind === "tooManyOpenOrders") setOrdersHref(result.ordersHref);
            return result.failure;
          },
        })
      }
    />
  );
}
