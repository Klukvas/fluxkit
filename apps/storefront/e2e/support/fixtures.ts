import {
  test as base,
  expect,
  type APIRequestContext,
  type PlaywrightWorkerArgs,
  type TestInfo,
} from "@playwright/test";
import { AdminApi, StoreApi } from "./api.ts";
import { E2E_ORIGIN, clientMarker } from "./env.ts";

export { expect };

let emailCounter = 0;

/** An email address no other test (and no earlier attempt of this one) uses: the open-orders limit counts per email. */
export function uniqueEmail(testInfo: TestInfo, label: string): string {
  emailCounter += 1;
  return `e2e-${label}-${String(testInfo.workerIndex)}-${String(testInfo.retry)}-${String(emailCounter)}@example.com`;
}

interface Fixtures {
  /** The shopper of the browser: the same cookie jar and address as the page. */
  shopper: StoreApi;
  /** Another shopper (own cookies, own client address), for "someone else bought it" scenarios. */
  otherShopper: StoreApi;
  /** The owner, signed in with its own client address. */
  admin: AdminApi;
}

/**
 * Every browser context and API context of a test sends `x-e2e-client: <number>` (the proxy turns it into the client address
 * the API's in-memory rate limits see), so tests and retries never share a window.
 */
export const test = base.extend<Fixtures>({
  // Playwright only reads `testInfo` when the first argument is an object pattern; `baseURL` doubles as a guard: the marker
  // means something to the proxy only, so the suite must never be pointed at another origin.
  extraHTTPHeaders: async ({ baseURL }, use, testInfo) => {
    if (baseURL !== E2E_ORIGIN) {
      throw new Error(
        `The e2e suite talks to the proxy at ${E2E_ORIGIN}, not to ${String(baseURL)}.`,
      );
    }
    await use({ "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry) });
  },
  shopper: async ({ page }, use) => {
    await use(new StoreApi(page.request));
  },
  otherShopper: async ({ playwright }, use, testInfo) => {
    const context = await newApiContext(
      playwright,
      clientMarker(testInfo.testId, testInfo.retry, "other"),
    );
    await use(new StoreApi(context));
    await context.dispose();
  },
  admin: async ({ playwright }, use, testInfo) => {
    const context = await newApiContext(
      playwright,
      clientMarker(testInfo.testId, testInfo.retry, "admin"),
    );
    await use(await AdminApi.signIn(context));
    await context.dispose();
  },
});

function newApiContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  marker: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { "x-e2e-client": marker },
  });
}
