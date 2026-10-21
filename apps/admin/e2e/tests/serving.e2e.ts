import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_CACHE_CONTROL, ADMIN_SECURITY_HEADERS } from "../../security-headers.ts";
import { SPA } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

/** A page response or an API response: only the headers are read. */
function expectStrictHeaders(
  response: { headers(): Record<string, string> } | null,
  cacheControl: string,
): void {
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
  // An inline script runs synchronously when it is appended, so its effect is known at once; the violation report follows.
  const ran = await page.evaluate(() => {
    const element = document.createElement("script");
    element.textContent = "window.__inlineRan = true;";
    document.body.append(element);
    return (window as unknown as { __inlineRan?: boolean }).__inlineRan === true;
  });
  expect(ran, "an inline script ran").toBe(false);
  await expect
    .poll(() => guard.csp.some((line) => line.startsWith("script-src-elem blocked inline")))
    .toBe(true);
});

/** The built file of a source module, from the build's manifest (`vite.config.ts`, `build.manifest`). */
function builtChunk(source: string): string {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../dist/.vite/manifest.json"), "utf8"),
  ) as Record<string, { file: string }>;
  const entry = manifest[source];
  if (entry === undefined) throw new Error(`${source} is not in the build manifest`);
  return entry.file;
}

test("an area chunk that cannot be loaded (a deployment replaced it) shows the error view in the shell; reload works when it is back", async ({
  page,
  signIn,
  guard,
}) => {
  // The orders area module, not its message file (both are named orders-*.js).
  const chunk = builtChunk("src/areas/orders/index.tsx");
  const chunkUrl = `${SPA}/${chunk}`;
  const importFailed = "Failed to fetch dynamically imported module";
  // Chunk names are `[A-Za-z0-9_-]` plus dots and slashes; only the dots need escaping.
  guard.expectConsoleErrors(
    new RegExp(`${importFailed}: .*${chunk.replaceAll(".", "\\.")}|net::ERR_FAILED`),
  );
  const logged = () => guard.consoleErrors.filter((line) => line.includes(importFailed)).length;
  await signIn("owner");
  const main = page.getByRole("main");
  const navigation = page.getByRole("navigation", { name: "Admin sections" });

  // In-app navigation while the chunk cannot be fetched (network error).
  await page.route(`**${chunkUrl}`, (route) => route.abort());
  await navigation.getByRole("link", { name: "Orders" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Reload the page" })).toBeVisible();
  // The shell stays: header and navigation are usable, another area opens.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect.poll(logged, "the failure is logged once").toBe(1);
  await navigation.getByRole("link", { name: "Products" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

  // A deep link while a deployment answers the old chunk with 404.
  await page.unroute(`**${chunkUrl}`);
  await page.route(`**${chunkUrl}`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto(`${SPA}/orders`);
  await expect(main.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect.poll(logged, "the failure is logged once").toBe(2);

  // The chunk is back: the reload button loads the page.
  await page.unroute(`**${chunkUrl}`);
  await main.getByRole("button", { name: "Reload the page" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  expect(logged()).toBe(2);
});
