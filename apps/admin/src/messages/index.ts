import type { Locale, Messages } from "@fluxkit/ui";
import enAccount from "./en/account.json";
import enAuth from "./en/auth.json";
import enCommon from "./en/common.json";
import enErrors from "./en/errors.json";
import enNavigation from "./en/navigation.json";
import enShell from "./en/shell.json";
import enStatus from "./en/status.json";
import ukAccount from "./uk/account.json";
import ukAuth from "./uk/auth.json";
import ukCommon from "./uk/common.json";
import ukErrors from "./uk/errors.json";
import ukNavigation from "./uk/navigation.json";
import ukShell from "./uk/shell.json";
import ukStatus from "./uk/status.json";
import enOverrides from "../messages-overrides/en.json";
import ukOverrides from "../messages-overrides/uk.json";
import { applyOverrides } from "./overrides";

/**
 * UI strings, one file per area and locale (`messages/{uk,en}/<file>.json`), so parallel steps touch disjoint files
 * (plan, "i18n"). Two kinds of files:
 * - EAGER files are part of the entry chunk: the shell, sign-in, the start page, the own account, every route title (the
 *   shell writes the title and the navigation before any area loads) and the problem-code map (`errors`).
 * - LAZY files belong to an area and are loaded with it: an area module names the files its screens use
 *   (`MESSAGE_FILES`), and the route renders the area only after they are loaded for the UI language
 *   (`i18n/area-messages.tsx`), so the translator never meets a missing key.
 * `messages.spec.ts` checks that both locales have the same files, keys and placeholders, and that the keys an area's
 * source uses are in the eager files or in the files that area declares.
 *
 * A client fork changes upstream texts (the admin's name, `app.name` and `app.documentTitle`, for example) in
 * `src/messages-overrides/<locale>.json` (fork-owned: upstream ships `{}` and never edits them), flat key -> text, applied
 * LAST to the eager files and to every lazily loaded file (`overrides.ts`; a bad value throws, a key no file has fails the
 * build, `brand-html.ts`). The parity and placeholder checks run on the merged result.
 */
export const EAGER_FILES: Record<Locale, Record<string, Messages>> = {
  uk: {
    account: ukAccount,
    auth: ukAuth,
    common: ukCommon,
    errors: ukErrors,
    navigation: ukNavigation,
    shell: ukShell,
    status: ukStatus,
  },
  en: {
    account: enAccount,
    auth: enAuth,
    common: enCommon,
    errors: enErrors,
    navigation: enNavigation,
    shell: enShell,
    status: enStatus,
  },
};

/** The lazily loaded message files. A later area adds its name here and two loaders below. */
export const LAZY_FILES = [
  "catalog-dictionaries",
  "products",
  "orders",
  "customers",
  "users",
  "shipping",
  "email",
  "payments",
  "privacy",
  "audit",
  "search",
  "help",
  "banners",
] as const;
/** A lazy file of the app's own areas. */
export type CoreLazyFile = (typeof LAZY_FILES)[number];

/**
 * The message file of an optional feature (`src/features/<name>/messages/<locale>.json`, ADR 0049): its keys all start with
 * `features.<name>.`. Loaded through the feature registry (`features/registry.ts`), never listed here.
 */
export type FeatureMessageFile = `feature:${string}`;

export type LazyFile = CoreLazyFile | FeatureMessageFile;

export type FileLoader = () => Promise<Messages>;

/**
 * One dynamic import per file and locale: Vite emits each JSON file as its own small chunk, so an area loads only the
 * language it shows.
 */
export const LAZY_FILE_LOADERS: Record<CoreLazyFile, Record<Locale, FileLoader>> = {
  "catalog-dictionaries": {
    uk: () => import("./uk/catalog-dictionaries.json").then((module) => module.default),
    en: () => import("./en/catalog-dictionaries.json").then((module) => module.default),
  },
  products: {
    uk: () => import("./uk/products.json").then((module) => module.default),
    en: () => import("./en/products.json").then((module) => module.default),
  },
  orders: {
    uk: () => import("./uk/orders.json").then((module) => module.default),
    en: () => import("./en/orders.json").then((module) => module.default),
  },
  customers: {
    uk: () => import("./uk/customers.json").then((module) => module.default),
    en: () => import("./en/customers.json").then((module) => module.default),
  },
  users: {
    uk: () => import("./uk/users.json").then((module) => module.default),
    en: () => import("./en/users.json").then((module) => module.default),
  },
  shipping: {
    uk: () => import("./uk/shipping.json").then((module) => module.default),
    en: () => import("./en/shipping.json").then((module) => module.default),
  },
  email: {
    uk: () => import("./uk/email.json").then((module) => module.default),
    en: () => import("./en/email.json").then((module) => module.default),
  },
  payments: {
    uk: () => import("./uk/payments.json").then((module) => module.default),
    en: () => import("./en/payments.json").then((module) => module.default),
  },
  privacy: {
    uk: () => import("./uk/privacy.json").then((module) => module.default),
    en: () => import("./en/privacy.json").then((module) => module.default),
  },
  audit: {
    uk: () => import("./uk/audit.json").then((module) => module.default),
    en: () => import("./en/audit.json").then((module) => module.default),
  },
  search: {
    uk: () => import("./uk/search.json").then((module) => module.default),
    en: () => import("./en/search.json").then((module) => module.default),
  },
  help: {
    uk: () => import("./uk/help.json").then((module) => module.default),
    en: () => import("./en/help.json").then((module) => module.default),
  },
  banners: {
    uk: () => import("./uk/banners.json").then((module) => module.default),
    en: () => import("./en/banners.json").then((module) => module.default),
  },
};

/** Merges message files; a key defined in two files is a bug and throws (no silent override). */
export function mergeAreas(areas: Record<string, Messages>): Messages {
  const merged: Messages = {};
  const origin: Record<string, string> = {};
  for (const [area, messages] of Object.entries(areas)) {
    for (const [key, message] of Object.entries(messages)) {
      if (key in merged) {
        throw new Error(`Message key "${key}" is defined in both ${origin[key]} and ${area}.`);
      }
      merged[key] = message;
      origin[key] = area;
    }
  }
  return merged;
}

/** A fork's text overrides per locale (`src/messages-overrides/<locale>.json`, `{}` upstream). */
export const OVERRIDE_FILES: Record<Locale, Readonly<Record<string, unknown>>> = {
  uk: ukOverrides,
  en: enOverrides,
};

/** Message files merged (a key in two files throws), then the overrides of their keys applied. */
export function buildMessages(
  files: Readonly<Record<string, Messages>>,
  overrides: Readonly<Record<string, unknown>>,
  locale: Locale,
): Messages {
  return applyOverrides(mergeAreas(files), overrides, locale);
}

/** The messages every screen can use from the first render. */
export const eagerMessages: Record<Locale, Messages> = {
  uk: buildMessages(EAGER_FILES.uk, OVERRIDE_FILES.uk, "uk"),
  en: buildMessages(EAGER_FILES.en, OVERRIDE_FILES.en, "en"),
};

/** The eager messages of a locale plus the given loaded lazy files (a key in two files throws), with the overrides. */
export function messagesWith(
  locale: Locale,
  loaded: Partial<Record<LazyFile, Messages>>,
): Messages {
  return buildMessages({ ...EAGER_FILES[locale], ...loaded }, OVERRIDE_FILES[locale], locale);
}

/**
 * Loads lazy files once per file and locale (concurrent callers share one request). A failed load is forgotten, so the
 * next call tries again; the error itself reaches the caller. `features` holds the loaders of the features' message files
 * (`features/registry.ts`); a file no loader knows is a bug and rejects.
 */
export function createFileLoader(
  loaders: Record<CoreLazyFile, Record<Locale, FileLoader>>,
  features: Readonly<Record<FeatureMessageFile, Record<Locale, FileLoader>>> = {},
) {
  const pending = new Map<string, Promise<Messages>>();
  const loaderOf = (file: LazyFile, locale: Locale): FileLoader | undefined => {
    if (Object.hasOwn(loaders, file)) return loaders[file as CoreLazyFile][locale];
    if (Object.hasOwn(features, file)) return features[file as FeatureMessageFile]?.[locale];
    return undefined;
  };
  return (file: LazyFile, locale: Locale): Promise<Messages> => {
    const key = `${locale}/${file}`;
    const known = pending.get(key);
    if (known !== undefined) return known;
    const loader = loaderOf(file, locale);
    if (loader === undefined) {
      return Promise.reject(new Error(`No loader for the message file "${file}" (${locale}).`));
    }
    const promise = loader().catch((error: unknown) => {
      pending.delete(key);
      throw error;
    });
    pending.set(key, promise);
    return promise;
  };
}

/** The app's own lazy files only; the SPA loads through `i18n/message-files.ts`, which adds the features' files. */
export const loadMessageFile = createFileLoader(LAZY_FILE_LOADERS);
