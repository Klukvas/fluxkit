import type {
  AdminShippingMethod,
  AdminShippingMethodKind,
  CreateAdminShippingMethodBody,
  UpdateAdminShippingMethodBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { nameIssue, type FormOptions } from "../catalog-dictionaries/dictionary-forms";
import {
  CODE_PATTERN,
  issue,
  parsePosition,
  type FormIssues,
} from "../catalog-dictionaries/form-rules";
import {
  localeMapFromValues,
  localeValuesFrom,
  optionalLocaleMap,
  type LocaleValues,
} from "../catalog-dictionaries/locale-text";
import {
  emptyPricingValues,
  pricingFromValues,
  pricingValuesFrom,
  type PricingValues,
} from "./pricing-form";

/**
 * The shipping method form (`docs/api/shipping.md`, "Shipping methods"): what it holds, the early checks, and the request
 * bodies. Pure; the screens only render it. Keys of the issue maps are the API's `errors[].path`, so a server answer and a
 * local check land on the same field. The server decides: it also checks that a provider is enabled and offers pickup points.
 */

export const METHOD_KINDS = [
  "address",
  "pickup_point",
  "store_pickup",
] as const satisfies readonly AdminShippingMethodKind[];

/** Core's `COUNTRY_CODE_PATTERN` and `SHIPPING_LIMITS.maxCountriesPerMethod` (copied: the SPA does not bundle core). */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
export const MAX_COUNTRIES = 250;
/** The API's `providerService` limit. */
export const PROVIDER_SERVICE_MAX_LENGTH = 64;

export type MethodFormMode = "create" | "edit";

export interface MethodFormValues {
  code: string;
  title: LocaleValues;
  description: LocaleValues;
  kind: AdminShippingMethodKind;
  providerCode: string;
  providerService: string;
  pricing: PricingValues;
  /** Two-letter codes separated by commas or spaces, as typed. */
  countries: string;
  isActive: boolean;
  /** Text: empty lets the API pick the place on create. */
  position: string;
}

export interface MethodFormContext extends FormOptions {
  /** Digits of the shop currency's minor unit (`GET /admin/config` `currencyExponent`): amounts are typed in it. */
  exponent: number;
}

export function emptyMethodForm(locales: readonly string[]): MethodFormValues {
  return {
    code: "",
    title: localeValuesFrom(null, locales),
    description: localeValuesFrom(null, locales),
    kind: "address",
    providerCode: "",
    providerService: "",
    pricing: emptyPricingValues("flat"),
    countries: "",
    isActive: false,
    position: "",
  };
}

/**
 * Whether the stored amounts are in the shop currency. The server stamps the shop currency on every saved pricing, so a
 * method priced in another currency (the shop currency changed since) must have its amounts typed again: showing the old
 * numbers in the new currency's units would silently change the price.
 */
export function pricedInShopCurrency(method: AdminShippingMethod, shopCurrency: string): boolean {
  return method.currency === shopCurrency;
}

export function methodFormFrom(
  method: AdminShippingMethod,
  locales: readonly string[],
  exponent: number,
  shopCurrency: string,
): MethodFormValues {
  return {
    code: method.code,
    title: localeValuesFrom(method.title, locales),
    description: localeValuesFrom(method.description, locales),
    kind: method.kind,
    providerCode: method.providerCode ?? "",
    providerService: method.providerService ?? "",
    pricing: pricedInShopCurrency(method, shopCurrency)
      ? pricingValuesFrom(method.pricing, exponent)
      : emptyPricingValues(method.pricing.type),
    countries: method.countryCodes.join(", "),
    isActive: method.isActive,
    position: String(method.position),
  };
}

/** The kinds that take a carrier: a store pickup has none. */
export function kindUsesProvider(kind: AdminShippingMethodKind): boolean {
  return kind !== "store_pickup";
}

export type CountriesResult =
  { ok: true; codes: string[] } | { ok: false; issue: MessageDescriptor };

/** Splits the typed list on commas, semicolons and white space; every code upper-cased; each country once, in typed order. */
export function parseCountries(text: string): CountriesResult {
  const typed = text
    .split(/[\s,;]+/u)
    .filter((part) => part !== "")
    .map((part) => part.toUpperCase());
  if (typed.length === 0) return { ok: false, issue: issue("errors.reason.required") };
  if (typed.length > MAX_COUNTRIES) {
    return { ok: false, issue: issue("ship.error.countriesTooMany", { max: MAX_COUNTRIES }) };
  }
  const bad = typed.find((code) => !COUNTRY_CODE_PATTERN.test(code));
  if (bad !== undefined)
    return { ok: false, issue: issue("ship.error.countryFormat", { code: bad }) };
  const repeated = typed.find((code, index) => typed.indexOf(code) !== index);
  if (repeated !== undefined) {
    return { ok: false, issue: issue("ship.reason.duplicate_country", { code: repeated }) };
  }
  return { ok: true, codes: typed };
}

export function validateMethodForm(
  values: MethodFormValues,
  mode: MethodFormMode,
  context: MethodFormContext,
): FormIssues {
  const found: FormIssues = {
    ...(mode === "create" && !CODE_PATTERN.test(values.code)
      ? { code: issue("ship.error.codeFormat") }
      : {}),
    ...nameIssue(values.title, "title", context),
  };
  const providerCode = values.providerCode.trim();
  const providerService = values.providerService.trim();
  if (kindUsesProvider(values.kind)) {
    if (providerCode !== "" && !CODE_PATTERN.test(providerCode)) {
      found["providerCode"] = issue("ship.error.codeFormat");
    } else if (providerCode === "" && (values.kind === "pickup_point" || providerService !== "")) {
      found["providerCode"] = issue("ship.reason.provider_required");
    }
    if (providerService.length > PROVIDER_SERVICE_MAX_LENGTH) {
      found["providerService"] = issue("errors.reason.too_long");
    }
  }
  const countries = parseCountries(values.countries);
  if (!countries.ok) found["countryCodes"] = countries.issue;
  if (!parsePosition(values.position).ok) found["position"] = issue("ship.error.position");
  const pricing = pricingFromValues(values.pricing, context.exponent);
  if (!pricing.ok) Object.assign(found, pricing.issues);
  return found;
}

/** The provider fields as the request holds them: both `null` for a kind without a carrier or an empty field. */
function providerFields(values: MethodFormValues): {
  providerCode: string | null;
  providerService: string | null;
} {
  if (!kindUsesProvider(values.kind)) return { providerCode: null, providerService: null };
  const providerCode = values.providerCode.trim();
  const providerService = values.providerService.trim();
  return {
    providerCode: providerCode === "" ? null : providerCode,
    // A service without a carrier is meaningless (the API refuses it): it is not sent.
    providerService: providerCode === "" || providerService === "" ? null : providerService,
  };
}

/** `POST /admin/shipping/methods`. Valid values only (`validateMethodForm` first). */
export function methodCreateBody(
  values: MethodFormValues,
  context: MethodFormContext,
): CreateAdminShippingMethodBody {
  const pricing = pricingFromValues(values.pricing, context.exponent);
  const countries = parseCountries(values.countries);
  if (!pricing.ok || !countries.ok) throw new Error("methodCreateBody needs validated values.");
  const position = parsePosition(values.position);
  const description = optionalLocaleMap(values.description, context.locales);
  const provider = providerFields(values);
  return {
    code: values.code,
    title: localeMapFromValues(values.title, context.locales),
    ...(description === undefined ? {} : { description }),
    kind: values.kind,
    ...(provider.providerCode === null ? {} : { providerCode: provider.providerCode }),
    ...(provider.providerService === null ? {} : { providerService: provider.providerService }),
    pricing: pricing.pricing,
    countryCodes: countries.codes,
    isActive: values.isActive,
    ...(position.ok && position.value !== undefined ? { position: position.value } : {}),
  };
}

/**
 * `PATCH /admin/shipping/methods/{id}`: the changed fields only (`diffForPatch`; a locale map, the pricing and the country
 * list are sent whole, as the API replaces them). A cleared description is `null`; a cleared provider is `null`. An emptied
 * position means "as before" (the API cannot clear a position). The initial pricing is left out of the comparison when its
 * amounts could not be shown (another currency), so the typed pricing is always sent then.
 */
export function methodPatchBody(
  initial: MethodFormValues,
  current: MethodFormValues,
  context: MethodFormContext,
  options: { pricingShown: boolean },
): UpdateAdminShippingMethodBody {
  const fields = (values: MethodFormValues, includePricing: boolean) => {
    const pricing = pricingFromValues(values.pricing, context.exponent);
    const countries = parseCountries(values.countries);
    const position = parsePosition(values.position);
    return {
      title: localeMapFromValues(values.title, context.locales),
      description: optionalLocaleMap(values.description, context.locales) ?? null,
      kind: values.kind,
      ...providerFields(values),
      ...(includePricing && pricing.ok ? { pricing: pricing.pricing } : {}),
      ...(countries.ok ? { countryCodes: countries.codes } : {}),
      isActive: values.isActive,
      ...(position.ok && position.value !== undefined ? { position: position.value } : {}),
    };
  };
  return diffForPatch(fields(initial, options.pricingShown), fields(current, true));
}
