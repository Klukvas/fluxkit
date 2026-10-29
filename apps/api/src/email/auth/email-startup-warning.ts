import { DEFAULT_STOREFRONT_PUBLIC_URL, TEST_ONLY_EMAIL_PROVIDERS } from "@fluxkit/config";

function isProduction(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? "").trim().toLowerCase() === "production";
}

/**
 * The one warning a production start without a mail provider logs (ADR 0031 decision 11): the shop runs, but nothing
 * that needs mail works. `undefined` when there is nothing to say (a provider is set, or not production).
 */
export function emailProviderStartupWarning(
  emailProvider: string | undefined,
  nodeEnv: string | undefined,
): string | undefined {
  if (!isProduction(nodeEnv) || (emailProvider !== undefined && emailProvider !== "none")) {
    return undefined;
  }
  return "EMAIL_PROVIDER is none: no mail is sent, so customers cannot reset passwords or verify their email (the reset and verification routes answer 404).";
}

/**
 * The warning a start outside production logs when a real provider sends mail but `STOREFRONT_PUBLIC_URL` is unset, so
 * every link in a mail (reset, verification, order) starts with the storefront's dev origin (email review F9). A
 * warning, not a refusal: a developer may run a real provider against a local storefront on purpose. Production
 * already refuses to start without the variable (`loadEnv`); the test-only provider delivers nothing.
 */
export function storefrontUrlStartupWarning(
  emailProvider: string | undefined,
  storefrontPublicUrl: string | undefined,
  nodeEnv: string | undefined,
): string | undefined {
  const realProvider =
    emailProvider !== undefined &&
    emailProvider !== "none" &&
    !TEST_ONLY_EMAIL_PROVIDERS.includes(emailProvider);
  const unset = storefrontPublicUrl === undefined || storefrontPublicUrl.trim() === "";
  if (isProduction(nodeEnv) || !realProvider || !unset) {
    return undefined;
  }
  return `STOREFRONT_PUBLIC_URL is not set: EMAIL_PROVIDER=${emailProvider} sends real mail whose links (password reset, email verification, orders) point at ${DEFAULT_STOREFRONT_PUBLIC_URL}. Set it to the storefront's public origin.`;
}
