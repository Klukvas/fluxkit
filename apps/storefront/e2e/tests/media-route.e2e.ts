import type { APIRequestContext, APIResponse, PlaywrightWorkerArgs } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, E2E_ORIGIN, clientMarker } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

const CSRF = { "X-Fluxkit-CSRF": "1" } as const;

/** A 1x1 PNG (70 bytes), made once by hand; the API re-encodes it. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function answer<T>(response: APIResponse, status: number): Promise<T> {
  const body = await response.text();
  expect(response.status(), `${response.url()}: ${body}`).toBe(status);
  return (body === "" ? undefined : JSON.parse(body)) as T;
}

async function signedInOwner(
  playwright: PlaywrightWorkerArgs["playwright"],
  testId: string,
  retry: number,
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { "x-e2e-client": clientMarker(testId, retry, "media-owner") },
  });
  await answer(
    await context.post("/admin/auth/login", {
      headers: CSRF,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }),
    200,
  );
  return context;
}

// What this proves, and what it does not: the proxy of this suite sends `/media/*` to the API (and not to the storefront),
// the API's answers come back unchanged, and a product whose image is an uploaded file still renders its page. It does NOT
// show the uploaded image in the storefront: the storefront accepts only absolute https URLs of `STOREFRONT_IMAGE_HOSTS`
// and the Next image optimizer refuses a loopback address (`dangerouslyAllowLocalIP` is off), so on this stack the page
// shows the placeholder. The upload itself is covered in a browser by `apps/admin/e2e`.
test("/media goes to the API through the proxy, and a product with an uploaded image renders its page with the placeholder", async ({
  page,
  playwright,
}, testInfo) => {
  const owner = await signedInOwner(playwright, testInfo.testId, testInfo.retry);
  try {
    const stored = await answer<{ url: string; contentType: string }>(
      await owner.post("/admin/media/uploads", {
        headers: { ...CSRF, "Content-Type": "application/octet-stream" },
        data: PNG_1X1,
      }),
      201,
    );
    expect(stored.url).toMatch(new RegExp(`^${E2E_ORIGIN}/media/[0-9a-f]{32}\\.png$`));
    const path = new URL(stored.url).pathname;

    // The file comes from the API, with the API's headers, and not from the storefront (which would answer with HTML).
    const file = await page.request.get(path);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toBe("image/png");
    expect(file.headers()["x-content-type-options"]).toBe("nosniff");
    expect(file.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(file.headers()["set-cookie"]).toBeUndefined();
    expect((await file.body()).subarray(1, 4).toString("latin1")).toBe("PNG");
    const head = await page.request.head(path);
    expect(head.status()).toBe(200);
    expect(head.headers()["content-type"]).toBe("image/png");
    for (const missing of [`/media/${"0".repeat(32)}.png`, "/media/..%2f..%2fetc%2fpasswd"]) {
      const none = await page.request.get(missing);
      expect(none.status(), missing).toBe(404);
      expect(none.headers()["cache-control"], missing).toBe("no-store");
      expect(none.headers()["content-type"], missing).not.toContain("text/html");
    }

    // A published product with that image.
    const suffix = `${String(testInfo.retry)}${testInfo.testId.slice(0, 6)}`;
    const type = await answer<{ id: string }>(
      await owner.post("/admin/product-types", {
        headers: CSRF,
        data: {
          code: `media_${suffix}`,
          name: { uk: "Медіа", en: "Media" },
          requiresShipping: false,
        },
      }),
      201,
    );
    const slug = `e2e-media-${suffix}`;
    const product = await answer<{ id: string; variants: { id: string }[] }>(
      await owner.post("/admin/products", {
        headers: CSRF,
        data: { productTypeId: type.id, title: { uk: "Фото", en: "Photo" }, slug },
      }),
      201,
    );
    const variant = product.variants[0];
    if (variant === undefined) throw new Error("a new product has its default variant");
    await answer(
      await owner.put(`/admin/products/${product.id}/prices`, {
        headers: CSRF,
        data: { items: [{ variantId: variant.id, currency: "UAH", amount: 12500 }] },
      }),
      200,
    );
    await answer(
      await owner.put(`/admin/products/${product.id}/media`, {
        headers: CSRF,
        data: { media: [{ url: stored.url, alt: { uk: "Вигляд спереду", en: "Front view" } }] },
      }),
      200,
    );
    await answer(await owner.post(`/admin/products/${product.id}/publish`, { headers: CSRF }), 200);
    const shown = await answer<{ media: { url: string }[] }>(
      await page.request.get(`/store/products/${slug}?locale=en`),
      200,
    );
    expect(shown.media.map((item) => item.url)).toEqual([stored.url]);

    const problems: string[] = [];
    const requested: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // The page asks `/store/account/me` for the signed-in customer; an anonymous visitor gets 401, which Chromium logs.
      const expected =
        /status of 401/.test(message.text()) &&
        new URL(message.location().url).pathname === "/store/account/me";
      if (!expected) problems.push(`console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    const response = await page.goto(`/en/p/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Photo" })).toBeVisible();
    // The placeholder (a labelled box, no <img>), because the address is not an https URL of an allowed host.
    await expect(page.getByRole("img", { name: "Front view" }).first()).toBeVisible();
    await expect(page.locator("img")).toHaveCount(0);
    expect(
      requested.filter(
        (pathname) => pathname.startsWith("/media/") || pathname.startsWith("/_next/image"),
      ),
    ).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    await owner.dispose();
  }
});
