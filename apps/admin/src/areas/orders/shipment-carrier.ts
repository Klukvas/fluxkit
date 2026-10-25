/** The typed reasons of a carrier failure (`docs/api/shipping.md`): never carrier text. */
export const CARRIER_REASONS = [
  "unavailable",
  "rejected",
  "invalid_credentials",
  "not_supported",
] as const;

/** Raw carrier codes, kept only when they have the documented shape (short, no spaces): they are shown as plain text. */
export function safeCarrierCodes(codes: readonly string[] | undefined): string[] {
  return (codes ?? []).filter((code) => /^[A-Za-z0-9_.-]{1,32}$/.test(code));
}
