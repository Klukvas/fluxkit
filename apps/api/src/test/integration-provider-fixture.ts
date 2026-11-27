import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SecretsKey, SecretsKeyRing } from "@fluxkit/config";
import type { ManagedTestShippingProvider } from "./managed-shipping-provider.js";
import type { ManagedTestPaymentProvider } from "./managed-payment-provider.js";

/**
 * Provider packages for the integration store specs, written to a temporary folder: no real package under
 * packages/providers is read, so the specs pass with every provider package deleted.
 *
 * - `testmail` (email): `api_key` and `webhook_secret`, with a format rule (`tm_` / `tmwh_` prefix).
 * - `testpay` (payment): `token`, managed transport, no format rule or online-check hook of its own.
 * - `brokenmail` (email): declares a secret but its entry file is missing.
 * - `fake` (email): a test-only code, hidden in production.
 * - `baddecl` (email): a malformed declaration, never offered.
 * - `nosecrets` (shipping): declares no secret, never offered.
 * - `nosymail` (email): names a variable that is not its own, never offered.
 * - `asyncmail` (email): its format rule answers a promise, so nothing can be saved for it.
 */
export interface IntegrationProviderFixture {
  readonly dir: string;
  remove(): Promise<void>;
}

const MANAGED_PAYMENT_HELPER = pathToFileURL(
  join(import.meta.dirname, "managed-payment-provider.ts"),
).href;

function managedPaymentEntry(code: string, formHandoff = false): string {
  return `
import { ManagedTestPaymentProvider } from ${JSON.stringify(MANAGED_PAYMENT_HELPER)};
export const fixture = new ManagedTestPaymentProvider(${JSON.stringify(code)}, ${formHandoff});
export const createOutboundClient = fixture.createOutboundClient;
export const locateWebhook = fixture.locateWebhook;
`;
}

export interface ManagedPaymentFixture extends IntegrationProviderFixture {
  readonly payment: ManagedTestPaymentProvider;
  readonly pair: ManagedTestPaymentProvider;
}

/** Only invented managed payment packages; no installed provider directory is consulted. */
export async function createManagedPaymentFixture(): Promise<ManagedPaymentFixture> {
  const dir = await mkdtemp(join(tmpdir(), "fluxkit-managed-payments-"));
  for (const code of ["testpay", "pairpay"]) {
    const fields = code === "testpay" ? ["token"] : ["public_key", "private_key"];
    await writePackage(
      dir,
      code,
      {
        provider: code,
        kind: "payment",
        secrets: fields.map((field) => ({
          field,
          purpose: "outbound",
          env: `${code.toUpperCase()}_${field.toUpperCase()}`,
        })),
      },
      managedPaymentEntry(code, code === "pairpay"),
    );
  }
  const load = async (code: string): Promise<ManagedTestPaymentProvider> => {
    const loaded = (await import(pathToFileURL(join(dir, code, "index.js")).href)) as {
      fixture: ManagedTestPaymentProvider;
    };
    return loaded.fixture;
  };
  return {
    dir,
    payment: await load("testpay"),
    pair: await load("pairpay"),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

export interface ManagedShippingFixture extends IntegrationProviderFixture {
  readonly shipping: ManagedTestShippingProvider;
}

export async function createManagedShippingFixture(): Promise<ManagedShippingFixture> {
  const dir = await mkdtemp(join(tmpdir(), "fluxkit-managed-shipping-"));
  const helper = pathToFileURL(join(import.meta.dirname, "managed-shipping-provider.ts")).href;
  await writePackage(
    dir,
    "testship",
    {
      provider: "testship",
      kind: "shipping",
      secrets: [{ field: "api_key", purpose: "outbound", env: "TESTSHIP_API_KEY" }],
      environments: {
        values: ["sandbox", "production"],
        default: "sandbox",
        env: "TESTSHIP_ENVIRONMENT",
      },
    },
    `
import { ManagedTestShippingProvider } from ${JSON.stringify(helper)};
export const fixture = new ManagedTestShippingProvider();
export const createOutboundClient = fixture.createOutboundClient;
export const checkCredentials = fixture.checkCredentials;
`,
  );
  const loaded = (await import(pathToFileURL(join(dir, "testship", "index.js")).href)) as {
    fixture: ManagedTestShippingProvider;
  };
  return { dir, shipping: loaded.fixture, remove: () => rm(dir, { recursive: true, force: true }) };
}

const VALIDATOR = `
const RULES = { api_key: /^tm_[A-Za-z0-9]{12,64}$/, webhook_secret: /^tmwh_[A-Za-z0-9]{12,64}$/ };
export function validateIntegrationSecret(field, value) {
  const rule = RULES[field];
  if (rule === undefined) return "Unknown secret field.";
  return rule.test(value) ? undefined : "Must be the test prefix and 12 to 64 letters or digits (the value is not shown).";
}
const sent = [];
export function createOutboundClient(secrets) {
  if (validateIntegrationSecret("api_key", secrets.api_key) !== undefined) {
    throw new Error("The stored outbound secret is not valid.");
  }
  return {
    code: "testmail",
    capabilities: Object.freeze({ idempotencyKeys: true, maxRecipients: 1 }),
    async send(_message, options) {
      sent.push(options.idempotencyKey);
      return { ok: true, value: { providerMessageId: "fixture-" + String(sent.length) } };
    },
  };
}
export function sentMessageIds() {
  return sent.slice();
}
`;

async function writePackage(
  root: string,
  folder: string,
  fluxkit: Record<string, unknown>,
  entry?: string,
): Promise<void> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: `fixture-${folder}`, type: "module", main: "./index.js", fluxkit }),
  );
  if (entry !== undefined) await writeFile(join(dir, "index.js"), entry);
}

export async function createIntegrationProviderFixture(): Promise<IntegrationProviderFixture> {
  const dir = await mkdtemp(join(tmpdir(), "fluxkit-integration-providers-"));
  await writePackage(
    dir,
    "testmail",
    {
      provider: "testmail",
      kind: "email",
      secrets: [
        { field: "api_key", purpose: "outbound", env: "TESTMAIL_API_KEY" },
        { field: "webhook_secret", purpose: "webhook", env: "TESTMAIL_WEBHOOK_SECRET" },
      ],
    },
    VALIDATOR,
  );
  await writePackage(
    dir,
    "testpay",
    {
      provider: "testpay",
      kind: "payment",
      secrets: [{ field: "token", purpose: "outbound", env: "TESTPAY_TOKEN" }],
    },
    managedPaymentEntry("testpay"),
  );
  await writePackage(dir, "brokenmail", {
    provider: "brokenmail",
    kind: "email",
    secrets: [{ field: "api_key", purpose: "outbound", env: "BROKENMAIL_API_KEY" }],
  });
  await writePackage(
    dir,
    "fake-email",
    {
      provider: "fake",
      kind: "email",
      secrets: [{ field: "api_key", purpose: "outbound", env: "FAKE_EMAIL_API_KEY" }],
    },
    "export const nothing = true;\n",
  );
  await writePackage(dir, "baddecl", {
    provider: "baddecl",
    kind: "email",
    secrets: [{ field: "API KEY", purpose: "outbound", env: "X" }],
  });
  await writePackage(dir, "nosecrets", { provider: "nosecrets", kind: "shipping" });
  await writePackage(dir, "nosymail", {
    provider: "nosymail",
    kind: "email",
    secrets: [{ field: "api_key", purpose: "outbound", env: "DATABASE_URL" }],
  });
  await writePackage(
    dir,
    "asyncmail",
    {
      provider: "asyncmail",
      kind: "email",
      secrets: [{ field: "api_key", purpose: "outbound", env: "ASYNCMAIL_API_KEY" }],
    },
    "export const validateIntegrationSecret = async () => undefined;\n",
  );
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

const ROUTE_CLIENT = (code: string) => `
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export function validateIntegrationSecret(field, value) {
  if (field !== "api_key") return "Unknown secret field.";
  return /^[A-Za-z0-9]{8,64}$/.test(value) ? undefined : "Must be 8 to 64 letters or digits.";
}
export function createOutboundClient() {
  return {
    code: "${code}",
    capabilities: Object.freeze({ idempotencyKeys: true, maxRecipients: 1 }),
    async send() {
      appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "sent.log"), "${code}\\n");
      if ("${code}" === "resend") {
        return { ok: false, reason: "quota_exceeded", providerCodes: [], quotaPeriod: "daily" };
      }
      return { ok: true, value: { providerMessageId: "accepted-1" } };
    },
  };
}
`;

/** Resend and Brevo stand-ins. Resend always answers a proven quota refusal; Brevo accepts. */
export async function createStoredRouteFixture(): Promise<IntegrationProviderFixture> {
  const dir = await mkdtemp(join(tmpdir(), "fluxkit-stored-email-route-"));
  await writeFile(join(dir, "sent.log"), "");
  for (const code of ["resend", "brevo"] as const) {
    await writePackage(
      dir,
      code,
      {
        provider: code,
        kind: "email",
        secrets: [{ field: "api_key", purpose: "outbound", env: `${code.toUpperCase()}_API_KEY` }],
      },
      ROUTE_CLIENT(code),
    );
  }
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** A fresh random master key, as `loadEnv` parses `SECRETS_ENCRYPTION_KEY`. */
export function testSecretsKey(id: string): SecretsKey {
  return { id, bytes: new Uint8Array(randomBytes(32)) };
}

export function testSecretsKeyRing(id = "test-key-1"): SecretsKeyRing {
  return { current: testSecretsKey(id), previous: null };
}
