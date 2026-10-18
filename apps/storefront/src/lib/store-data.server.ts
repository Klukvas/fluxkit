import { loadStorefrontEnv } from "@fluxkit/config";
import { locales } from "@fluxkit/ui";
import { connection } from "next/server";
import { loadNavigationCategories } from "./navigation-categories";
import { createStoreData, ensureLocalesSupported } from "./store-data";

/**
 * The server-side store data of the running app. Server code only: it reads the process environment and must never be
 * imported from a client component (a test guards this). `connection()` keeps every catalog read out of prerendering, so
 * `next build` never needs the API; `API_INTERNAL_URL` is read per request, after that, and fails loudly when it is wrong.
 */
export const storeData = createStoreData({
  baseUrl: () => loadStorefrontEnv(process.env).apiInternalUrl,
  beforeRequest: connection,
});

export function ensureStorefrontLocales(): Promise<void> {
  return ensureLocalesSupported(storeData, locales);
}

export function navigationCategories(locale: string) {
  return loadNavigationCategories(storeData, locale);
}
