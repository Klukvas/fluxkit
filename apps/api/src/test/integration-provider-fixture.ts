import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretsKey, SecretsKeyRing } from "@fluxkit/config";

/**
 * Provider packages for the integration store specs, written to a temporary folder: no real package under
 * packages/providers is read, so the specs pass with every provider package deleted.
 *
 * - `testmail` (email): `api_key` and `webhook_secret`, with a format rule (`tm_` / `tmwh_` prefix).
 * - `testpay` (payment): `token`, no format rule of its own.
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

const VALIDATOR = `
const RULES = { api_key: /^tm_[A-Za-z0-9]{12,64}$/, webhook_secret: /^tmwh_[A-Za-z0-9]{12,64}$/ };
export function validateIntegrationSecret(field, value) {
  const rule = RULES[field];
  if (rule === undefined) return "Unknown secret field.";
  return rule.test(value) ? undefined : "Must be the test prefix and 12 to 64 letters or digits (the value is not shown).";
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
    "export const nothing = true;\n",
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

/** A fresh random master key, as `loadEnv` parses `SECRETS_ENCRYPTION_KEY`. */
export function testSecretsKey(id: string): SecretsKey {
  return { id, bytes: new Uint8Array(randomBytes(32)) };
}

export function testSecretsKeyRing(id = "test-key-1"): SecretsKeyRing {
  return { current: testSecretsKey(id), previous: null };
}
