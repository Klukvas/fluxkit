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

/** Loads the primary and ordered fallbacks dynamically. No provider package is a static API dependency. */
export function loadEmailProvider(options: {
  provider: string;
  fallbacks?: readonly string[];
  providersDir: string;
}): Promise<LoadedEmailProvider[]> {
  const fallbacks = options.fallbacks ?? [];
  const enabled = options.provider === "none" ? [] : [options.provider, ...fallbacks];
  if (
    (options.provider === "none" && fallbacks.length > 0) ||
    fallbacks.some((code) => code === "none" || !EMAIL_PROVIDER_CODE_PATTERN.test(code)) ||
    new Set(enabled).size !== enabled.length
  ) {
    throw new Error(
      "EMAIL_FALLBACK_PROVIDERS must contain distinct provider codes, exclude none and EMAIL_PROVIDER, and have an enabled primary.",
    );
  }
  return loadProviderPackages({
    kind: EMAIL_PROVIDER_PACKAGE_KIND,
    enabled,
    providersDir: options.providersDir,
    codePattern: EMAIL_PROVIDER_CODE_PATTERN,
    variable: "EMAIL_PROVIDER",
  });
}
