import type { Locale, Messages } from "@fluxkit/ui";
import enOverrides from "../messages-overrides/en.json";
import ukOverrides from "../messages-overrides/uk.json";
import type { MessageArea } from "./areas";
import enAccount from "./en/account.json";
import enCart from "./en/cart.json";
import enCatalog from "./en/catalog.json";
import enCheckout from "./en/checkout.json";
import enErrors from "./en/errors.json";
import enHome from "./en/home.json";
import enLegal from "./en/legal.json";
import enOrder from "./en/order.json";
import enPages from "./en/pages.json";
import enPayment from "./en/payment.json";
import enProduct from "./en/product.json";
import enSearch from "./en/search.json";
import enShell from "./en/shell.json";
import ukAccount from "./uk/account.json";
import ukCart from "./uk/cart.json";
import ukCatalog from "./uk/catalog.json";
import ukCheckout from "./uk/checkout.json";
import ukErrors from "./uk/errors.json";
import ukHome from "./uk/home.json";
import ukLegal from "./uk/legal.json";
import ukOrder from "./uk/order.json";
import ukPages from "./uk/pages.json";
import ukPayment from "./uk/payment.json";
import ukProduct from "./uk/product.json";
import ukSearch from "./uk/search.json";
import ukShell from "./uk/shell.json";

/**
 * UI strings (plan docs/plans/2026-11-08-design-changeability.md, WP3): one file per area and locale,
 * `messages/<locale>/<area>.json`, with FLAT keys (`"site.name"`); which namespace goes in which area is the one map in
 * `areas.ts`. Every file is imported statically, so a page needs no file system and the bundler sees every text. A client
 * fork changes upstream texts in its own `src/messages-overrides/<locale>.json` (upstream ships `{}` and never edits it),
 * merged LAST, before `pickClientMessages` picks the browser's subset (`components/site-shell.tsx`), so the server and the
 * browser render the same text. `next.config.ts` repeats this merge in plain Node for the legal release check (it cannot
 * import this file); `next.config.spec.ts` keeps the two equal.
 */
export const MESSAGE_FILES: Record<Locale, Record<MessageArea, Messages>> = {
  uk: {
    shell: ukShell,
    home: ukHome,
    catalog: ukCatalog,
    product: ukProduct,
    search: ukSearch,
    cart: ukCart,
    checkout: ukCheckout,
    order: ukOrder,
    payment: ukPayment,
    account: ukAccount,
    errors: ukErrors,
    legal: ukLegal,
    pages: ukPages,
  },
  en: {
    shell: enShell,
    home: enHome,
    catalog: enCatalog,
    product: enProduct,
    search: enSearch,
    cart: enCart,
    checkout: enCheckout,
    order: enOrder,
    payment: enPayment,
    account: enAccount,
    errors: enErrors,
    legal: enLegal,
    pages: enPages,
  },
};

const OVERRIDE_FILES: Record<Locale, Readonly<Record<string, unknown>>> = {
  uk: ukOverrides,
  en: enOverrides,
};

/** Merges area files; a key defined in two files is a bug and throws (no silent winner). */
export function mergeAreas(areas: Readonly<Record<string, Messages>>): Messages {
  const merged: Messages = {};
  const origin: Record<string, string> = {};
  for (const [area, messages] of Object.entries(areas)) {
    for (const [key, message] of Object.entries(messages)) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`Message key "${key}" is defined in both ${origin[key]} and ${area}.`);
      }
      merged[key] = message;
      origin[key] = area;
    }
  }
  return merged;
}

/**
 * Applies a fork's overrides (flat key -> text) over the merged base. Throws on a key the base does not have (a typo or a
 * key upstream renamed would otherwise change nothing, silently) and on a value that is not a non-empty string, naming the
 * key and the file. Throwing here fails `next build` and every page, not only the one that shows the text.
 */
export function applyOverrides(
  base: Readonly<Messages>,
  overrides: Readonly<Record<string, unknown>>,
  locale: string,
): Messages {
  const file = `src/messages-overrides/${locale}.json`;
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(base, key)) {
      throw new Error(
        `Message override "${key}" in ${file} has no base message (a typo, or a key upstream renamed or removed).`,
      );
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Message override "${key}" in ${file} must be a non-empty string.`);
    }
    merged[key] = value;
  }
  return merged;
}

/** The messages of one locale: its area files merged, then its overrides applied. */
export function buildLocaleMessages(
  areas: Readonly<Record<string, Messages>>,
  overrides: Readonly<Record<string, unknown>>,
  locale: string,
): Messages {
  return applyOverrides(mergeAreas(areas), overrides, locale);
}

/** The upstream texts without the fork's overrides (for the specs and the overrides check). */
export const baseMessagesByLocale: Record<Locale, Messages> = {
  uk: mergeAreas(MESSAGE_FILES.uk),
  en: mergeAreas(MESSAGE_FILES.en),
};

/** What the app renders: the upstream texts with the fork's overrides applied. */
export const messagesByLocale: Record<Locale, Messages> = {
  uk: applyOverrides(baseMessagesByLocale.uk, OVERRIDE_FILES.uk, "uk"),
  en: applyOverrides(baseMessagesByLocale.en, OVERRIDE_FILES.en, "en"),
};
