"use client";

import type { ShippingCity, ShippingOption, ShippingPickupPoint } from "@fluxkit/api-client";
import { Alert, Button, type Locale, type Translator } from "@fluxkit/ui";
import { useState, type ReactNode } from "react";
import {
  SHIPPING_CITY_FIELD,
  SHIPPING_CITY_NAME_FIELD,
  SHIPPING_METHOD_FIELD,
  SHIPPING_POINT_FIELD,
  SHIPPING_POINT_TEXT_FIELD,
  type CheckoutValues,
} from "../lib/checkout-form";
import { failureText, type Failure } from "../lib/failure";
import { createLookupSource } from "../lib/lookup-source";
import { formatMoney } from "../lib/money";
import { isOrderable, type ShippingState } from "../lib/shipping-model";
import { pickupKindKey, shippingPriceText, unavailableText } from "../lib/shipping-text";
import { fieldMessage } from "./form-parts";
import { LookupCombobox } from "./lookup-combobox";
import { useStoreClient } from "./session-provider";

/** The cities API needs at least two characters (`docs/api/shipping.md`). */
export const CITY_MIN_CHARS = 2;
/** One page of pickup points; the API allows up to 200, a list that long is not a list to pick from. */
export const POINT_PAGE_SIZE = 50;
/** Longest `q` of the pickup point lookup. */
const POINT_QUERY_MAX = 50;

export interface DeliverySectionViewProps {
  t: Translator;
  locale: Locale;
  exponent: number;
  shipping: ShippingState;
  options: readonly ShippingOption[];
  methodCode: string;
  /** Element id of the method group (the target of an error link and of the focus after a failed submit). */
  methodId: string;
  failure: Failure | null;
  onSelectMethod: (methodCode: string) => void;
  onRetry: () => void;
  /** The city and pickup point pickers; the island passes them because they own the lookups. */
  pickup: ReactNode;
}

/**
 * The "Delivery" section of the checkout (shipping plan step 10): one radio per method of `GET /store/shipping/options`
 * with its title, what it costs (from i18n: a price, "Free", or "paid to the carrier on delivery, about X") or why it cannot
 * be chosen, then the part of the form the chosen method needs: the pickers of a pickup point, or the pickup text of a store.
 * The address fields of a method that delivers to an address are rendered by the page below this section. Pure: props in,
 * markup out. Every amount is the API's, only formatted.
 */
export function DeliverySectionView(props: DeliverySectionViewProps) {
  const { t, locale, exponent, shipping, options, methodCode, methodId, failure } = props;
  const money = (value: Parameters<typeof formatMoney>[0]) => formatMoney(value, exponent, locale);
  const selected = options.find((option) => option.methodCode === methodCode);
  const orderable = selected !== undefined && isOrderable(selected);
  const methodError = fieldMessage(failure, SHIPPING_METHOD_FIELD, t);
  const errorId = `${methodId}-error`;
  return (
    <fieldset
      id={methodId}
      tabIndex={-1}
      aria-describedby={methodError === undefined ? undefined : errorId}
      className="flex flex-col gap-4 rounded-md outline-offset-2 focus:outline-2 focus:outline-ring"
    >
      <legend className="mb-2 text-xl font-semibold text-foreground">
        <h2>{t("checkout.shipping.title")}</h2>
      </legend>
      {shipping.failure === null ? null : (
        <Alert variant="danger" title={t("checkout.shipping.error.title")}>
          <p>{failureText(t, shipping.failure)}</p>
          <Button className="mt-3" onClick={props.onRetry}>
            {t("checkout.shipping.error.retry")}
          </Button>
        </Alert>
      )}
      {shipping.failure !== null || options.some(isOrderable) ? null : (
        <Alert variant="warning">
          <p>{t("checkout.shipping.noneAvailable")}</p>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const available = isOrderable(option);
          const detailId = `${methodId}-${option.methodCode}-detail`;
          return (
            <label
              key={option.methodCode}
              className="flex cursor-pointer gap-3 rounded-md border border-border p-3 has-checked:border-primary has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name={SHIPPING_METHOD_FIELD}
                value={option.methodCode}
                checked={option.methodCode === methodCode}
                disabled={!available}
                aria-describedby={detailId}
                onChange={() => props.onSelectMethod(option.methodCode)}
                className="mt-1 size-5 shrink-0 accent-primary"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium text-foreground">{option.title}</span>
                <span id={detailId} className="flex flex-col gap-1 text-sm text-muted-foreground">
                  <span className={available ? "text-foreground" : undefined}>
                    {available ? shippingPriceText(t, option, money) : unavailableText(t, option)}
                  </span>
                  {option.description !== null && option.kind !== "store_pickup" ? (
                    <span>{option.description}</span>
                  ) : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {methodError === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {methodError}
        </p>
      )}
      {orderable && selected.kind === "store_pickup" ? (
        <section aria-labelledby={`${methodId}-store-heading`} className="flex flex-col gap-1">
          <h3 id={`${methodId}-store-heading`} className="font-semibold text-foreground">
            {t("checkout.shipping.storePickup.title")}
          </h3>
          <p className="whitespace-pre-line text-foreground">
            {selected.description ?? t("checkout.shipping.storePickup.empty")}
          </p>
        </section>
      ) : null}
      {orderable && selected.kind === "pickup_point" ? props.pickup : null}
    </fieldset>
  );
}

export interface PickupPointFieldsProps {
  t: Translator;
  locale: Locale;
  /** The carrier of the chosen method. */
  providerCode: string;
  values: CheckoutValues;
  failure: Failure | null;
  ids: Readonly<Record<string, string>>;
  onValueChange: (path: string, value: string) => void;
}

function cityText(t: Translator, city: ShippingCity): string {
  return city.region === null
    ? city.name
    : t("checkout.shipping.city.option", { name: city.name, region: city.region });
}

function pointText(t: Translator, point: ShippingPickupPoint): string {
  return t("checkout.shipping.point.option", {
    kind: t(pickupKindKey(point.kind)),
    number: point.number,
    description: point.description,
  });
}

/**
 * The two pickers of a pickup point method: a city, then a branch or parcel locker of that city. Both search through our
 * API with the typed client (the browser never reaches a carrier; the CSP allows only this origin). The chosen city and
 * point are form values (`shipping.cityRef`, `shipping.pickupPointRef`, with their texts); the point list is a new
 * component per city so a city change drops the old list and the old point at once.
 */
export function PickupPointFields(props: PickupPointFieldsProps) {
  const { t, locale, providerCode, values, failure, ids, onValueChange } = props;
  const client = useStoreClient();
  const [cities] = useState(() =>
    createLookupSource<ShippingCity>({
      minChars: CITY_MIN_CHARS,
      search: (query) => client.listShippingCities(providerCode, query, { locale, limit: 20 }),
    }),
  );
  const cityRef = values[SHIPPING_CITY_FIELD] ?? "";
  const cityName = values[SHIPPING_CITY_NAME_FIELD] ?? "";
  const pointRef = values[SHIPPING_POINT_FIELD] ?? "";
  const pointLabel = values[SHIPPING_POINT_TEXT_FIELD] ?? "";
  const cityError = fieldMessage(failure, SHIPPING_CITY_FIELD, t);
  const pointError = fieldMessage(failure, SHIPPING_POINT_FIELD, t);

  const clearCity = () => {
    for (const path of [SHIPPING_CITY_FIELD, SHIPPING_CITY_NAME_FIELD]) onValueChange(path, "");
    for (const path of [SHIPPING_POINT_FIELD, SHIPPING_POINT_TEXT_FIELD]) onValueChange(path, "");
  };
  const clearPoint = () => {
    for (const path of [SHIPPING_POINT_FIELD, SHIPPING_POINT_TEXT_FIELD]) onValueChange(path, "");
  };

  return (
    <div className="flex flex-col gap-4">
      <LookupCombobox<ShippingCity>
        t={t}
        id={ids[SHIPPING_CITY_FIELD] as string}
        name={SHIPPING_CITY_FIELD}
        label={t("checkout.shipping.city.label")}
        hint={t("checkout.shipping.city.hint", { count: CITY_MIN_CHARS })}
        {...(cityError === undefined ? {} : { error: cityError })}
        required
        source={cities}
        toOption={(city) => ({ key: city.ref, text: cityText(t, city) })}
        selectedText={cityRef === "" ? null : cityName}
        onChoose={(city) => {
          onValueChange(SHIPPING_CITY_FIELD, city.ref);
          onValueChange(SHIPPING_CITY_NAME_FIELD, cityText(t, city));
          clearPoint();
        }}
        onClear={clearCity}
      />
      {cityRef === "" ? (
        <p className="text-sm text-muted-foreground">{t("checkout.shipping.point.needCity")}</p>
      ) : (
        <PointPicker
          key={cityRef}
          t={t}
          providerCode={providerCode}
          cityRef={cityRef}
          id={ids[SHIPPING_POINT_FIELD] as string}
          selectedText={pointRef === "" ? null : pointLabel}
          error={pointError}
          onChoose={(point) => {
            onValueChange(SHIPPING_POINT_FIELD, point.ref);
            onValueChange(SHIPPING_POINT_TEXT_FIELD, pointText(t, point));
          }}
          onClear={clearPoint}
        />
      )}
    </div>
  );
}

function PointPicker(props: {
  t: Translator;
  providerCode: string;
  cityRef: string;
  id: string;
  selectedText: string | null;
  error: string | undefined;
  onChoose: (point: ShippingPickupPoint) => void;
  onClear: () => void;
}) {
  const { t, providerCode, cityRef } = props;
  const client = useStoreClient();
  const [points] = useState(() =>
    createLookupSource<ShippingPickupPoint>({
      // The API has no minimum for points, and branch numbers are short ("5"): any text narrows the list.
      minChars: 1,
      searchEmpty: true,
      search: (query) =>
        client.listShippingPickupPoints(providerCode, cityRef, {
          limit: POINT_PAGE_SIZE,
          ...(query === "" ? {} : { q: query.slice(0, POINT_QUERY_MAX) }),
        }),
    }),
  );
  return (
    <LookupCombobox<ShippingPickupPoint>
      t={t}
      id={props.id}
      name={SHIPPING_POINT_FIELD}
      label={t("checkout.shipping.point.label")}
      hint={t("checkout.shipping.point.hint")}
      {...(props.error === undefined ? {} : { error: props.error })}
      required
      source={points}
      listOnMount
      toOption={(point) => ({ key: point.ref, text: pointText(t, point) })}
      selectedText={props.selectedText}
      onChoose={props.onChoose}
      onClear={props.onClear}
    />
  );
}
