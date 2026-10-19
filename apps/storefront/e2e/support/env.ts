import { createHash } from "node:crypto";

/** Ports and credentials of the e2e stack. Throwaway values for a database that is wiped at every run. */
export const E2E_API_PORT = Number(process.env["E2E_API_PORT"] ?? 3100);
export const E2E_STOREFRONT_PORT = Number(process.env["E2E_STOREFRONT_PORT"] ?? 3101);
/** The only origin a browser sees: the proxy (`proxy.ts`). */
export const E2E_PORT = Number(process.env["E2E_PORT"] ?? 3102);
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

export const ADMIN_EMAIL = "e2e-owner@example.com";
export const ADMIN_PASSWORD = "e2e-owner-password-0123456789";

/** Suffix the e2e database must end with; see `prepare-database.ts`. */
export const E2E_DATABASE_SUFFIX = "_e2e_test";

/** An environment as a plain map (`process.env` has a read-only `NODE_ENV` in the Next.js typings). */
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
 * and no fallback to `DATABASE_URL`.
 */
export function requireE2eDatabaseUrl(env: Env = process.env): string {
  const url = env["E2E_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      `E2E_DATABASE_URL must be set (apps/storefront/e2e/README.md): a database whose name ends in "${E2E_DATABASE_SUFFIX}", for example postgres://user:password@127.0.0.1:5432/fluxkit${E2E_DATABASE_SUFFIX}. The suite wipes it.`,
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
 * number per test attempt and per role inside it, so no two tests (and no retry) share a rate-limit window.
 */
export function clientMarker(testId: string, retry: number, role = "browser"): string {
  const digest = createHash("sha256")
    .update(`${testId}:${String(retry)}:${role}`)
    .digest();
  // 24 bits: the proxy maps the number to 10.a.b.c. Collisions between the ~20 contexts of one run are astronomically rare.
  return String(
    ((digest[0] as number) << 16) | ((digest[1] as number) << 8) | (digest[2] as number),
  );
}

function requireVariable(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} must be set to run the e2e suite (apps/storefront/e2e/README.md, same variables as the integration tests).`,
    );
  }
  return value;
}

/**
 * The complete environment of every API process the suite starts (the migration, the seed, the owner and the server). It
 * starts from the shell so PATH and the service URLs come through, and SETS everything that decides behaviour: a variable
 * a developer has exported for another purpose (`TRUST_PROXY`, `FEATURES_ENABLED`, a cookie flag) must not change the run.
 * The root `.env` is never read: the processes are started with plain `node`, not with the package scripts' `--env-file`.
 */
export function apiEnvironment(env: Env = process.env): Env {
  const result: Env = {
    ...env,
    DATABASE_URL: requireE2eDatabaseUrl(env),
    REDIS_URL: requireVariable(env, "REDIS_URL"),
    MEILI_URL: requireVariable(env, "MEILI_URL"),
    MEILI_MASTER_KEY: requireVariable(env, "MEILI_MASTER_KEY"),
    PORT: String(E2E_API_PORT),
    // Throwaway secret of a wiped database (ADR 0023: at least 32 characters).
    ORDER_TOKEN_SECRET: "e2e-order-token-secret-0123456789-abcdef",
    // Plain HTTP on 127.0.0.1, one proxy hop in front (proxy.ts sets X-Forwarded-For).
    STORE_COOKIE_SECURE: "false",
    ADMIN_COOKIE_SECURE: "false",
    TRUST_PROXY: "1",
    FEATURES_ENABLED: "",
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
  };
  // The seed refuses NODE_ENV=production and the API must not run in a mode a developer's shell chose.
  delete result["NODE_ENV"];
  return result;
}
