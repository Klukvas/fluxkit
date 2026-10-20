import type { Response } from "@playwright/test";
import { ADMIN_CACHE_CONTROL, ADMIN_SECURITY_HEADERS } from "../../security-headers.ts";
import { SPA } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

function expectStrictHeaders(response: Response | null, cacheControl: string): void {
  expect(response, "a document response").not.toBeNull();
  const headers = response?.headers() ?? {};
  for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) {
    expect(headers[name.toLowerCase()], name).toBe(value);
  }
  // The values themselves, not only "the same as the file": a weakened file must fail here too.
  expect(headers["content-security-policy"]).toContain("script-src 'self';");
  expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cache-control"]).toBe(cacheControl);
}

test("the SPA answers /admin-ui/ and /admin-ui with the strict headers; assets are immutable", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  const withSlash = await page.goto(`${SPA}/`);
  expectStrictHeaders(withSlash, ADMIN_CACHE_CONTROL.html);
  await expect(page.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();

  // The router writes the start page without a slash (the brand link): it must be served too.
  const withoutSlash = await page.goto(SPA);
  expectStrictHeaders(withoutSlash, ADMIN_CACHE_CONTROL.html);
  await expect(page.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fluxkit Admin" })).toHaveAttribute("href", SPA);

  const script = await page.locator('script[type="module"]').first().getAttribute("src");
  expect(script).toMatch(new RegExp(`^${SPA}/assets/`));
  const asset = await page.request.get(script ?? "");
  expect(asset.status()).toBe(200);
  expectStrictHeaders(asset, ADMIN_CACHE_CONTROL.assets);
});

test("a deep link loads and reloads through the index.html fallback", async ({ page, signIn }) => {
  await signIn("owner");
  const first = await page.goto(`${SPA}/catalog/brands`);
  expectStrictHeaders(first, ADMIN_CACHE_CONTROL.html);
  await expect(page.getByRole("heading", { level: 1, name: "Brands" })).toBeVisible();

  await page.getByRole("link", { name: "demo-brand" }).click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/catalog/brands/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1, name: /Demo Brand/ })).toBeVisible();
  const reloaded = await page.reload();
  expectStrictHeaders(reloaded, ADMIN_CACHE_CONTROL.html);
  expect(reloaded?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { level: 1, name: /Demo Brand/ })).toBeVisible();

  // An unknown SPA path is the SPA's own not-found view, not a server 404.
  const unknown = await page.goto(`${SPA}/no/such/screen`);
  expect(unknown?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  // `/admin/*` stays the API, never the SPA.
  const api = await page.request.get("/admin/auth/me");
  expect(api.headers()["content-type"]).toContain("application/json");
});

test("the CSP refuses inline script and the SPA itself causes no violation", async ({
  page,
  signIn,
  guard,
}) => {
  await signIn("owner");
  await page.goto(`${SPA}/products`);
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  // Everything up to here ran under the policy without a single violation (the guard fails the test otherwise).
  guard.expectCspViolations(/script-src|Refused to execute inline script/);
  const ran = await page.evaluate(async () => {
    const scope = window as unknown as { __inlineRan?: boolean };
    const element = document.createElement("script");
    element.textContent = "window.__inlineRan = true;";
    const violation = new Promise<string>((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => {
        resolve(event.effectiveDirective);
      });
    });
    document.body.append(element);
    return { directive: await violation, ran: scope.__inlineRan === true };
  });
  expect(ran).toEqual({ directive: "script-src-elem", ran: false });
  await expect.poll(() => guard.csp.length).toBeGreaterThan(0);
});
