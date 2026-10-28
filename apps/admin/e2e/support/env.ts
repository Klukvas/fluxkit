import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Ports and credentials of the admin e2e stack. Throwaway values for a database that is wiped at every run. The ports differ
 * from the storefront suite's (3100 to 3102), so the two suites never meet even when one is left running by accident.
 */
export const ADMIN_E2E_API_PORT = Number(process.env["ADMIN_E2E_API_PORT"] ?? 3110);
/** The only origin a browser sees: the proxy (`proxy.ts`). */
export const ADMIN_E2E_PORT = Number(process.env["ADMIN_E2E_PORT"] ?? 3112);
export const ADMIN_E2E_ORIGIN = `http://127.0.0.1:${String(ADMIN_E2E_PORT)}`;
/** The SPA's base path (`src/router/base-path.ts`). */
export const SPA = "/admin-ui";

/**
 * Where the API of this suite stores uploaded images: a directory under the system temp directory, never the repository's
 * `var/media`. The path is fixed per proxy port (the config file is evaluated by Playwright's main process and by every
 * worker, so a random name would differ between them); `prepare-database.ts` wipes and creates it before the API starts and
 * `global-teardown.ts` removes it.
 */
export const ADMIN_E2E_MEDIA_DIR = join(
  tmpdir(),
  `fluxkit-admin-e2e-media-${String(ADMIN_E2E_PORT)}`,
);

/** The owner made by `prepare-database.ts` with the built `create-admin`. */
export const OWNER_EMAIL = "e2e-owner@example.com";
export const OWNER_PASSWORD = "e2e-owner-password-0123456789";
/** Made by `global-setup.ts` through the users API with the owner's session. */
export const MANAGER_EMAIL = "e2e-manager@example.com";
export const MANAGER_PASSWORD = "e2e-manager-password-0123456789";
export const VIEWER_EMAIL = "e2e-viewer@example.com";
export const VIEWER_PASSWORD = "e2e-viewer-password-0123456789";

/** Suffix the e2e database must end with; see `prepare-database.ts`. */
export const E2E_DATABASE_SUFFIX = "_e2e_test";

/** An environment as a plain map. */
export type Env = Record<string, string | undefined>;

/** The name of the database in a connection URL, or `undefined` when it cannot be read. */
export function databaseNameOf(connectionUrl: string): string | undefined {
  try {
    return decodeURIComponent(new URL(connectionUrl).pathname.replace(/^\//, ""));
  } catch {
    return undefined;
  }
}

/**
 * `E2E_DATABASE_URL` is required and its database name must end in `_e2e_test`: the suite DROPS everything in that database
 * at every run, so it must never be a database that `pnpm test` (`_test`) or a developer (`_dev`) uses. There is no default
 * and no fallback to `DATABASE_URL`. The storefront suite uses the same variable and the same rule; `pnpm test:e2e` runs the
 * suites one after the other and each wipes the database at its start.
 */
export function requireE2eDatabaseUrl(env: Env = process.env): string {
  const url = env["E2E_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      `E2E_DATABASE_URL must be set (apps/admin/e2e/README.md): a database whose name ends in "${E2E_DATABASE_SUFFIX}", for example postgres://user:password@127.0.0.1:5432/fluxkit${E2E_DATABASE_SUFFIX}. The suite wipes it.`,
    );
  }
  const name = databaseNameOf(url);
  if (name === undefined || !name.endsWith(E2E_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to wipe database ${name === undefined ? "(name unreadable)" : `"${name}"`}: E2E_DATABASE_URL must point at a database whose name ends in "${E2E_DATABASE_SUFFIX}".`,
    );
  }
  return url;
}

/**
 * The marker a test puts on its requests (`x-e2e-client`); the proxy turns it into the client address the API sees. One
 * number per test attempt and per role inside it, so no two tests (and no retry) share a login rate-limit window.
 */
export function clientMarker(testId: string, retry: number, role = "browser"): string {
  const digest = createHash("sha256")
    .update(`admin:${testId}:${String(retry)}:${role}`)
    .digest();
  // 24 bits: the proxy maps the number to 10.a.b.c. Collisions between the ~100 contexts of one run are astronomically rare.
  return String(
    ((digest[0] as number) << 16) | ((digest[1] as number) << 8) | (digest[2] as number),
  );
}

function requireVariable(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} must be set to run the admin e2e suite (apps/admin/e2e/README.md, same variables as the integration tests).`,
    );
  }
  return value;
}

/**
 * The complete environment of every API process the suite starts (the migration, the seed, the owner and the server). It
 * starts from the shell so PATH and the service URLs come through, and SETS everything that decides behaviour: a variable a
 * developer exported for another purpose (`TRUST_PROXY`, `FEATURES_ENABLED`, a cookie flag) must not change the run. The
 * root `.env` is never read: the processes are started with plain `node`, not with the package scripts' `--env-file`.
 */
export function apiEnvironment(env: Env = process.env): Env {
  const result: Env = {
    ...env,
    DATABASE_URL: requireE2eDatabaseUrl(env),
    REDIS_URL: requireVariable(env, "REDIS_URL"),
    MEILI_URL: requireVariable(env, "MEILI_URL"),
    MEILI_MASTER_KEY: requireVariable(env, "MEILI_MASTER_KEY"),
    PORT: String(ADMIN_E2E_API_PORT),
    // Throwaway secret of a wiped database (ADR 0023: at least 32 characters).
    ORDER_TOKEN_SECRET: "e2e-order-token-secret-0123456789-abcdef",
    // Plain HTTP on 127.0.0.1, one proxy hop in front (proxy.ts sets X-Forwarded-For).
    STORE_COOKIE_SECURE: "false",
    ADMIN_COOKIE_SECURE: "false",
    TRUST_PROXY: "1",
    FEATURES_ENABLED: "",
    // The test-only carrier of the template (packages/providers/_fake): shipping settings and waybills need one provider.
    SHIPPING_PROVIDERS_ENABLED: "fake",
    // No online payment in these suites (payments plan step 4: an empty list loads no provider); a value in the developer's shell must not change the run.
    PAYMENT_PROVIDERS_ENABLED: "",
    // The test-only email provider (packages/providers/_fake-email): the Email area needs a provider to send a test mail, and
    // the fake delivers nothing. No capture file: the scenarios read the outbox through the admin API. The scheduler is off
    // (below), so only the immediate attempt of a test send or a resend runs; order mails stay pending.
    EMAIL_PROVIDER: "fake",
    EMAIL_FROM: "Fluxkit E2E <shop@example.com>",
    STOREFRONT_PUBLIC_URL: ADMIN_E2E_ORIGIN,
    // No background timers: nothing in the suite depends on expiry, and a sweep must not race a test.
    SCHEDULER_ENABLED: "false",
    DEFAULT_LOCALE: "uk",
    LOCALES: "uk,en",
    SHOP_CURRENCY: "UAH",
    PRICES_INCLUDE_TAX: "true",
    LOW_STOCK_THRESHOLD: "5",
    MAX_OPEN_ORDERS: "3",
    ORDER_PAYMENT_TTL_MINUTES: "30",
    ORDER_GUEST_ACCESS_DAYS: "90",
    // Uploads on a temp directory; the URLs the API hands out point at the proxy, so the browser loads them through it.
    MEDIA_STORAGE_DRIVER: "local",
    MEDIA_DIR: ADMIN_E2E_MEDIA_DIR,
    MEDIA_PUBLIC_BASE_URL: `${ADMIN_E2E_ORIGIN}/media`,
    MEDIA_MAX_BYTES: "10485760",
    MEDIA_MAX_PIXELS: "50000000",
  };
  // The seed refuses NODE_ENV=production and the API must not run in a mode a developer's shell chose.
  delete result["NODE_ENV"];
  return result;
}
