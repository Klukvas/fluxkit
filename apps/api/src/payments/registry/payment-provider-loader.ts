import { fileURLToPath } from "node:url";
import { PAYMENT_PROVIDER_CODE_PATTERN, PAYMENT_PROVIDER_PACKAGE_KIND } from "@fluxkit/core";
import {
  loadProviderPackages,
  type LoadedProviderPackage,
} from "../../common/provider-package-loader.js";

export type LoadedPaymentProvider = LoadedProviderPackage;

/** Default location of provider packages: <repo>/packages/providers (also works from dist/). */
export const DEFAULT_PAYMENT_PROVIDERS_DIR = fileURLToPath(
  new URL("../../../../../packages/providers", import.meta.url),
);

/**
 * Loads exactly the enabled payment providers (ADR 0032 decision 3, "Provider loading"): the manifest scan and the
 * dynamic import are the shared `loadProviderPackages` with `kind: "payment"`, so only the packages `PAYMENT_PROVIDERS_ENABLED`
 * names are imported and neither core nor this app references a provider statically. With nothing enabled (the default:
 * no online payment) the folder is not even read. An enabled provider that is missing, broken or without `providerModule`
 * fails loudly at startup.
 */
export function loadPaymentProviders(options: {
  enabled: readonly string[];
  providersDir: string;
}): Promise<LoadedPaymentProvider[]> {
  return loadProviderPackages({
    kind: PAYMENT_PROVIDER_PACKAGE_KIND,
    enabled: options.enabled,
    providersDir: options.providersDir,
    codePattern: PAYMENT_PROVIDER_CODE_PATTERN,
    variable: "PAYMENT_PROVIDERS_ENABLED",
  });
}
