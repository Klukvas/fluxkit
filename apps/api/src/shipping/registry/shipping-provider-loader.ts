import { fileURLToPath } from "node:url";
import { SHIPPING_PROVIDER_CODE_PATTERN, SHIPPING_PROVIDER_PACKAGE_KIND } from "@fluxkit/core";
import {
  loadProviderPackages,
  type LoadedProviderPackage,
} from "../../common/provider-package-loader.js";

export type LoadedShippingProvider = LoadedProviderPackage;

/** Default location of provider packages: <repo>/packages/providers (also works from dist/). */
export const DEFAULT_SHIPPING_PROVIDERS_DIR = fileURLToPath(
  new URL("../../../../../packages/providers", import.meta.url),
);

/**
 * Loads exactly the enabled shipping providers (ADR 0029 decision 8): the manifest scan and the dynamic import are the
 * shared `loadProviderPackages` with `kind: "shipping"`. With nothing enabled the folder is not even read; an enabled
 * provider that is missing, broken or without `providerModule` fails loudly at startup.
 */
export function loadShippingProviders(options: {
  enabled: readonly string[];
  providersDir: string;
}): Promise<LoadedShippingProvider[]> {
  return loadProviderPackages({
    kind: SHIPPING_PROVIDER_PACKAGE_KIND,
    enabled: options.enabled,
    providersDir: options.providersDir,
    codePattern: SHIPPING_PROVIDER_CODE_PATTERN,
    variable: "SHIPPING_PROVIDERS_ENABLED",
  });
}
