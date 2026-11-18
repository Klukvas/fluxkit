/** The only stored email providers that may be on at the same time, in send order. */
export const STORED_EMAIL_ROUTE = ["resend", "brevo"] as const;

/**
 * One stored email provider of any code may be on. A second is allowed only when every enabled code is Resend or Brevo.
 */
export function storedEmailActivationAllowed(
  enabledCodes: readonly string[],
  nextCode: string,
): boolean {
  const codes = [...new Set([...enabledCodes, nextCode])];
  if (codes.length <= 1) return true;
  return codes.every((code) => (STORED_EMAIL_ROUTE as readonly string[]).includes(code));
}

/**
 * Orders an enabled stored chain. A single provider stays as it is. Resend and Brevo are always Resend then Brevo.
 * Any other combination of two enabled providers is a broken route and stops the send.
 */
export function storedEmailChain<T extends { readonly providerCode: string }>(
  rows: readonly T[],
): readonly T[] {
  if (rows.length <= 1) return [...rows];
  const byCode = new Map(rows.map((row) => [row.providerCode, row]));
  const paired = STORED_EMAIL_ROUTE.flatMap((code) => {
    const row = byCode.get(code);
    return row === undefined ? [] : [row];
  });
  if (paired.length !== rows.length) {
    throw new Error("More than one email integration is enabled.");
  }
  return paired;
}
