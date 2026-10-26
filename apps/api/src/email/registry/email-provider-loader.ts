import { fileURLToPath } from "node:url";
import { EMAIL_PROVIDER_CODE_PATTERN, EMAIL_PROVIDER_PACKAGE_KIND } from "@fluxkit/core";
import {
  loadProviderPackages,
  type LoadedProviderPackage,
} from "../../common/provider-package-loader.js";

export type LoadedEmailProvider = LoadedProviderPackage;

/** Default location of provider packages: <repo>/packages/providers (also works from dist/). */
export const DEFAULT_EMAIL_PROVIDERS_DIR = fileURLToPath(
  new URL("../../../../../packages/providers", import.meta.url),
);

/**
 * Loads the one email provider that `EMAIL_PROVIDER` names (ADR 0031 decision 4): the shared `loadProviderPackages` with
 * `kind: "email"`, so only that package is imported, dynamically; neither core nor this app references a provider
 * statically. `none` loads nothing and does not read the folder. A named provider that is missing, broken or without
 * `providerModule` fails loudly at startup. Answers a list of zero or one so the test option `extraEmailProviders` and the
 * registry share one shape.
 */
export function loadEmailProvider(options: {
  /** The value of `EMAIL_PROVIDER`: `none` or a provider code. */
  provider: string;
  providersDir: string;
}): Promise<LoadedEmailProvider[]> {
  return loadProviderPackages({
    kind: EMAIL_PROVIDER_PACKAGE_KIND,
    enabled: options.provider === "none" ? [] : [options.provider],
    providersDir: options.providersDir,
    codePattern: EMAIL_PROVIDER_CODE_PATTERN,
    variable: "EMAIL_PROVIDER",
  });
}
