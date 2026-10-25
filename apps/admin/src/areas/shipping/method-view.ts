import type {
  AdminConfig,
  AdminShippingMethod,
  AdminShippingMethodKind,
  AdminShippingPricing,
} from "@fluxkit/api-client";
import type { StatusTone, Translator } from "@fluxkit/ui";
import { exponentOf } from "../../lib/currency-exponent";
import { formatMoney } from "../../lib/format";
import { buildPath, PATHS } from "../../router/paths";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";

/**
 * How the shipping settings present what the API answered. Pure. Every amount is formatted from the integer minor units the
 * API sent, with the exponent of the method's own currency from the admin config; nothing is computed here.
 */

export function kindLabelKey(kind: AdminShippingMethodKind): string {
  return `ship.kind.${kind}`;
}

export const METHOD_STATUS_TONES: Record<"active" | "inactive", StatusTone> = {
  active: "success",
  inactive: "neutral",
};

export function methodStatusLabelKey(isActive: boolean): string {
  return `ship.status.${isActive ? "active" : "inactive"}`;
}

export function methodHref(id: string): string {
  return buildPath(PATHS.shippingMethodDetail, { id });
}

export function providerHref(code: string): string {
  return buildPath(PATHS.shippingProviderDetail, { code });
}

/** The method's title in the UI language, else the default language, else the first by locale code. */
export function methodTitle(
  method: Pick<AdminShippingMethod, "title" | "code">,
  uiLocale: string,
  defaultLocale: string,
): string {
  return resolveLocalized(method.title, uiLocale, defaultLocale) || method.code;
}

/** One line for a list: what the shop charges, in words and money of the method's currency. */
export function pricingSummary(
  t: Translator,
  pricing: AdminShippingPricing,
  currency: string,
  config: AdminConfig,
  uiLocale: string,
): string {
  const exponent = exponentOf(config, currency);
  const money = (amount: number) => formatMoney({ amount, currency }, exponent, uiLocale);
  switch (pricing.type) {
    case "flat":
      return t("ship.pricing.summary.flat", { amount: money(pricing.amount) });
    case "free_over":
      return t("ship.pricing.summary.free_over", {
        amount: money(pricing.amount),
        freeFrom: money(pricing.freeFrom),
      });
    case "tiers":
      return t("ship.pricing.summary.tiers", { count: pricing.tiers.length });
    case "carrier_on_delivery":
      return t("ship.pricing.summary.carrier_on_delivery");
  }
}

/** The carrier of a method as text: the provider code and the service, or `null` (no carrier). */
export function carrierText(
  method: Pick<AdminShippingMethod, "providerCode" | "providerService">,
): string | null {
  if (method.providerCode === null) return null;
  return method.providerService === null
    ? method.providerCode
    : `${method.providerCode} / ${method.providerService}`;
}

/** The distinct carrier codes the methods name, sorted (the API has no list of enabled carriers). */
export function carrierCodesOf(
  methods: readonly Pick<AdminShippingMethod, "providerCode">[],
): string[] {
  return [
    ...new Set(
      methods.flatMap((method) => (method.providerCode === null ? [] : [method.providerCode])),
    ),
  ].sort();
}
