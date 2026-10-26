/**
 * The one warning a production start without a mail provider logs (ADR 0031 decision 11): the shop runs, but nothing
 * that needs mail works. `undefined` when there is nothing to say (a provider is set, or not production).
 */
export function emailProviderStartupWarning(
  emailProvider: string | undefined,
  nodeEnv: string | undefined,
): string | undefined {
  const production = (nodeEnv ?? "").trim().toLowerCase() === "production";
  if (!production || (emailProvider !== undefined && emailProvider !== "none")) {
    return undefined;
  }
  return "EMAIL_PROVIDER is none: no mail is sent, so customers cannot reset passwords or verify their email (the reset and verification routes answer 404).";
}
