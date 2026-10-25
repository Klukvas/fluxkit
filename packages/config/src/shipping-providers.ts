/**
 * The shape of a shipping provider code. Repeated from `SHIPPING_PROVIDER_CODE_PATTERN` in `@fluxkit/core` because this
 * package does not depend on core; `apps/api` asserts that the two are equal.
 */
export const SHIPPING_PROVIDER_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Provider codes that exist for tests only (`packages/providers/_fake`: made-up cities, points and waybills). `loadEnv`
 * refuses them when `NODE_ENV` is production (review m-5), so a shop can never accept fake pickup points or create fake
 * waybills. Not a list of real providers.
 */
export const TEST_ONLY_SHIPPING_PROVIDERS: readonly string[] = Object.freeze(["fake"]);

/**
 * Parses the comma-separated SHIPPING_PROVIDERS_ENABLED value into a validated, de-duplicated list of provider codes.
 * An unset or empty value means no shipping provider is loaded. Like FEATURES_ENABLED, a malformed entry fails loudly;
 * the message names the variable and the offending entry (a code is not a secret).
 */
export function parseEnabledShippingProviders(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const codes = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  for (const code of codes) {
    if (!SHIPPING_PROVIDER_CODE.test(code)) {
      throw new Error(
        `Invalid shipping provider code "${code}" in SHIPPING_PROVIDERS_ENABLED. Use lowercase letters, digits and underscores, starting with a letter.`,
      );
    }
  }
  return [...new Set(codes)];
}
