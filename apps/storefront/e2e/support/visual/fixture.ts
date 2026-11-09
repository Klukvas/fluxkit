import { test as base } from "@playwright/test";
import { E2E_ORIGIN, clientMarker } from "../env.ts";

export { expect } from "@playwright/test";

/**
 * The visual specs' `test`: like `../fixtures.ts`, every request carries an `x-e2e-client` marker (the proxy turns it into
 * the client address the API's rate limits see), so no two tests share a window. Self-contained on purpose: the harness also
 * runs inside the base tree (`scripts/visual-compare.sh`), whose other e2e helpers may differ.
 */
export const test = base.extend({
  extraHTTPHeaders: async ({ baseURL }, use, testInfo) => {
    if (baseURL !== E2E_ORIGIN) {
      throw new Error(
        `The visual suite talks to the proxy at ${E2E_ORIGIN}, not to ${String(baseURL)}.`,
      );
    }
    await use({ "x-e2e-client": clientMarker(testInfo.testId, testInfo.retry, "visual") });
  },
});
