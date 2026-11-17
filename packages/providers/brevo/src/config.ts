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

/** Dedicated bearer credential; never reuse the API key. This is the only webhook-secret accessor. */
export function readBrevoWebhookSecret(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const secret = env.BREVO_WEBHOOK_SECRET ?? "";
  if (secret.trim() === "") return undefined;
  if (secret === env.BREVO_API_KEY) {
    throw new BrevoConfigError(
      "BREVO_WEBHOOK_SECRET must differ from BREVO_API_KEY (the values are not shown).",
    );
  }
  if (!/^[A-Za-z0-9_-]{43,1024}$/.test(secret)) {
    throw new BrevoConfigError(
      "BREVO_WEBHOOK_SECRET must contain 43 to 1024 URL-safe base64 characters (the value is not shown).",
    );
  }
  return secret;
}

/**
 * The format rule of one managed secret field (`fluxkit.secrets` in package.json, ADR 0058), asked by the admin
 * integration store before it encrypts a pasted value. Answers the problem (it names the rule, never the value) or
 * `undefined`. The same accessors check the value when it comes from the environment.
 */
export function validateIntegrationSecret(field: string, value: string): string | undefined {
  try {
    if (field === "api_key") {
      parseBrevoEnv({ BREVO_API_KEY: value });
      return undefined;
    }
    if (field === "webhook_secret") {
      // The "differs from the API key" rule needs both values and is checked when the provider is activated.
      readBrevoWebhookSecret({ BREVO_WEBHOOK_SECRET: value });
      return undefined;
    }
  } catch (error) {
    if (error instanceof BrevoConfigError) return error.message;
    throw error;
  }
  return "Unknown secret field.";
}
