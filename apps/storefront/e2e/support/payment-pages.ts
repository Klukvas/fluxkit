import type { Page } from "@playwright/test";

export const PROVIDER_HOST = "https://pay.fake.invalid";

/** Answers the provider's host with a stub page, so the redirect has somewhere to land and nothing leaves the machine. */
export async function stubProviderPages(page: Page): Promise<string[]> {
  const visited: string[] = [];
  await page.route(`${PROVIDER_HOST}/**`, async (route) => {
    visited.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Stub provider</title><h1>Stub provider page</h1>",
    });
  });
  return visited;
}

export interface CreatedAnswer {
  paymentId: string;
  status: string;
  redirectUrl: string;
}

/**
 * Lets the create call through to the REAL API and keeps its answer. The browser leaves for the provider's page as soon as
 * the answer arrives, and a response body that is read after that navigation is gone, so the test reads it here.
 */
export async function captureCreate(
  page: Page,
  pathEnd: string,
): Promise<() => Promise<CreatedAnswer>> {
  let answer: ((value: CreatedAnswer) => void) | null = null;
  const captured = new Promise<CreatedAnswer>((resolve) => {
    answer = resolve;
  });
  await page.route(`**${pathEnd}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    answer?.((await response.json()) as CreatedAnswer);
    await route.fulfill({ response });
  });
  return () => captured;
}
