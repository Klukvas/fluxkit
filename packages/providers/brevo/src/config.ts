/** TODO(fluxkit): not live-verified — B7 activation/DNS/deliverability; B8 terms/DPA/transfers/retention;
 * B9 event/tag visibility and reconciliation; later webhook authentication/tuple/retries/subscriptions.
 * B5/B6 free allowance/reset, queue expiry/cancellation, branding and tracking require owner checks.
 * Fixed production origin and path; only the HTTP test constructor can select a loopback stub. */
export const BREVO_API_ORIGIN = "https://api.brevo.com";
export const BREVO_SEND_PATH = "/v3/smtp/email";
export const BREVO_USER_AGENT = "fluxkit-provider-brevo/1";
export interface BrevoConfig {
  readonly apiKey: string;
}
export class BrevoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrevoConfigError";
  }
}
/** No undocumented prefix. Reject controls/whitespace, including at the edges, before constructing a header. */
export function parseBrevoEnv(env: Readonly<Record<string, string | undefined>>): BrevoConfig {
  const key = env.BREVO_API_KEY ?? "";
  if (key.trim() === "")
    throw new BrevoConfigError(
      "BREVO_API_KEY is required when EMAIL_PROVIDER=brevo. See .env.example.",
    );
  if (key.length > 1024 || !/^[\x21-\x7E]+$/.test(key) || /\s/.test(key)) {
    throw new BrevoConfigError(
      "BREVO_API_KEY must contain 1 to 1024 visible ASCII characters without whitespace (the value is not shown).",
    );
  }
  return Object.freeze({ apiKey: key });
}
