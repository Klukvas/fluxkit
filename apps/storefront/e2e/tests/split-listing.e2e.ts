import { randomUUID } from "node:crypto";
import type { ProductList, SearchResult } from "@fluxkit/api-client";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext, Page } from "@playwright/test";
import { AdminApi } from "../support/api.ts";
import { apiEnvironment, E2E_ORIGIN, E2E_SEARCH_ENABLED } from "../support/env.ts";
import { expect, test as base } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

base.setTimeout(240_000);

const CSRF = { "X-Fluxkit-CSRF": "1" };
const run = promisify(execFile);

async function rebuildSearch(): Promise<void> {
  if (!E2E_SEARCH_ENABLED) return;
  // The suite's scheduler is off. Use its own scoped engine key and e2e database, just like prepare-database.ts.
  await run(
    process.execPath,
    [resolve(import.meta.dirname, "../../../api/dist/search/reindex.js")],
    {
      env: apiEnvironment() as NodeJS.ProcessEnv,
    },
  );
}

async function call<T>(
  context: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await context.fetch(path, {
    method,
    headers: CSRF,
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  expect(response.ok(), `${method} ${path}: ${response.status()} ${text}`).toBe(true);
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

type Option = { id: string; code: string; values: { id: string; code: string }[] };
type Variant = { id: string; optionValues: { optionCode: string; valueCode: string }[] };
const card = (page: Page, name: string) =>
  page.getByRole("article").filter({ has: page.getByRole("link", { name, exact: true }) });

interface SplitProduct {
  slug: string;
  productId: string;
  blueVariantId: string;
}

const test = base.extend<{ split: SplitProduct }>({
  split: async ({ request }, use, testInfo) => {
    await AdminApi.signIn(request);
    const suffix = randomUUID().slice(0, 8);
    const code = `split_listing_e2e_${suffix}`;
    const slug = `split-listing-e2e-${suffix}`;
    const title = testInfo.title.includes("server HTML")
      ? { uk: "Демо серверний поділ", en: "Split server sample" }
      : { uk: "Демо поділ", en: "Split sample" };
    const type = await call<{ id: string }>(request, "POST", "/admin/product-types", {
      code,
      name: { uk: "Демо поділ", en: "Split sample" },
      requiresShipping: false,
    });
    const options = await call<{ items: { id: string; code: string }[] }>(
      request,
      "GET",
      "/admin/options?limit=100",
    );
    const definitions = await Promise.all(
      ["color", "size"].map(async (code) => {
        const entry = options.items.find((option) => option.code === code);
        if (entry === undefined) throw new Error(`Missing fixture option ${code}`);
        return call<Option>(request, "GET", `/admin/options/${entry.id}`);
      }),
    );
    const [color, size] = definitions;
    if (color === undefined || size === undefined) throw new Error("Missing fixture definitions");
    let productId: string | undefined;
    try {
      await call(request, "PUT", `/admin/product-types/${type.id}/options/${color.id}`, {
        position: 0,
        splitsListing: true,
      });
      await call(request, "PUT", `/admin/product-types/${type.id}/options/${size.id}`, {
        position: 1,
      });
      const product = await call<{ id: string }>(request, "POST", "/admin/products", {
        productTypeId: type.id,
        slug,
        title,
      });
      productId = product.id;
      await call(request, "PUT", `/admin/products/${product.id}/options`, {
        options: [
          {
            optionId: color.id,
            valueIds: color.values
              .filter((value) => ["white", "blue"].includes(value.code))
              .map((value) => value.id),
          },
          {
            optionId: size.id,
            valueIds: size.values
              .filter((value) => ["m", "l"].includes(value.code))
              .map((value) => value.id),
          },
        ],
      });
      await call(request, "PUT", `/admin/products/${product.id}/media`, {
        media: ["white", "blue"].map((code, position) => ({
          url: `https://images.example.com/split-${code}.webp`,
          alt: { uk: `Демо ${code}`, en: `Sample ${code}` },
          position,
          optionId: color.id,
          optionValueId: color.values.find((value) => value.code === code)?.id,
        })),
      });
      const variants = await call<{ items: Variant[] }>(
        request,
        "GET",
        `/admin/products/${product.id}/variants`,
      );
      const blue = variants.items.find(
        (variant) =>
          variant.optionValues.some(
            (pair) => pair.optionCode === "color" && pair.valueCode === "blue",
          ) &&
          variant.optionValues.some((pair) => pair.optionCode === "size" && pair.valueCode === "m"),
      );
      if (blue === undefined) throw new Error("Missing blue M variant");
      for (const variant of variants.items) {
        const blueL =
          variant.optionValues.some(
            (pair) => pair.optionCode === "color" && pair.valueCode === "blue",
          ) &&
          variant.optionValues.some((pair) => pair.optionCode === "size" && pair.valueCode === "l");
        await call(
          request,
          "PUT",
          `/admin/products/${product.id}/variants/${variant.id}/prices/UAH`,
          { amount: 10000 },
        );
        if (blueL)
          await call(request, "PATCH", `/admin/products/${product.id}/variants/${variant.id}`, {
            isActive: false,
          });
      }
      const categories = await call<{ items: { id: string; slug: string }[] }>(
        request,
        "GET",
        "/admin/categories?limit=100",
      );
      const category = categories.items.find((entry) => entry.slug === "demo-tools");
      if (category === undefined) throw new Error("Missing fixture category");
      await call(request, "PUT", `/admin/products/${product.id}/categories`, {
        categories: [{ categoryId: category.id }],
      });
      await call(request, "POST", `/admin/products/${product.id}/publish`);
      await rebuildSearch();

      await use({ slug, productId: product.id, blueVariantId: blue.id });
    } finally {
      // Only this type is split: no fixture flags change. Restore its assignment and hide the test product before the next spec.
      await call(request, "PUT", `/admin/product-types/${type.id}/options/${color.id}`, {
        splitsListing: false,
      });
      if (productId !== undefined)
        await call(request, "POST", `/admin/products/${productId}/archive`);
      await rebuildSearch();
    }
  },
});

// Sitemap product reads share a one-hour cache with earlier specs. Its product-only grouping is covered in lib/sitemap.spec.ts.
test("isolated split assignment: server HTML and live API preserve group offers", async ({
  request,
  split,
}) => {
  test.setTimeout(180_000);
  const listing = await call<ProductList>(
    request,
    "GET",
    "/store/products?locale=en&groupBy=listing&limit=100",
  );
  const groups = listing.items.filter((item) => item.id === split.productId);
  expect(groups).toHaveLength(2);
  expect(new Set(groups.map((item) => item.listingKey)).size).toBe(2);
  expect(groups.map((item) => item.listingOption?.valueCode).sort()).toEqual(["blue", "white"]);
  for (const item of groups) {
    expect(item.image?.url).toBe(
      `https://images.example.com/split-${item.listingOption?.valueCode}.webp`,
    );
    expect(item.defaultVariantId).toBe(
      item.listingOption?.valueCode === "blue" ? split.blueVariantId : null,
    );
  }
  if (E2E_SEARCH_ENABLED) {
    const search = await call<SearchResult>(
      request,
      "GET",
      "/store/search?locale=en&groupBy=listing&q=Split",
    );
    expect(
      search.items
        .filter((item) => item.id === split.productId)
        .map((item) => item.listingKey)
        .sort(),
    ).toEqual(groups.map((item) => item.listingKey).sort());
  }
  const paths = [
    "/en/catalog",
    "/en/c/demo-tools",
    "/en/catalog?view=list",
    "/uk/catalog",
    "/en",
    ...(E2E_SEARCH_ENABLED ? ["/en/search?q=Split"] : []),
  ];
  for (const path of paths) {
    await expect(async () => {
      const response = await request.get(path);
      expect(response.ok()).toBe(true);
      const html = await response.text();
      const uk = path.startsWith("/uk");
      expect(html).toContain(uk ? "Демо серверний поділ — Білий" : "Split server sample — White");
      expect(html).toContain(uk ? "Демо серверний поділ — Синій" : "Split server sample — Blue");
      for (const value of ["blue", "white"])
        expect(html).toContain(`href="/${uk ? "uk" : "en"}/p/${split.slug}?opt.color=${value}"`);
    }).toPass({ timeout: 90_000, intervals: [1000, 5000] });
  }
  if (E2E_SEARCH_ENABLED) {
    const filtered = await request.get("/en/search?q=Split&f=opt.size%3Am");
    expect(filtered.ok()).toBe(true);
    expect(await filtered.text()).toContain(
      `href="/en/p/${split.slug}?opt.color=white&amp;opt.size=m"`,
    );
  }
});

test("isolated split assignment: group links, size picker, add/choose and no-JS", async ({
  page,
  browser,
  split,
}) => {
  test.setTimeout(240_000);
  const { slug } = split;
  const paths = [
    "/en/catalog",
    "/en/c/demo-tools",
    "/en/catalog?view=list",
    "/uk/catalog",
    "/en",
    ...(E2E_SEARCH_ENABLED ? ["/en/search?q=Split"] : []),
  ];
  for (const path of paths) {
    // A home or catalog read may precede the test's writes (server readiness, previous specs): allow the accepted 60 s cache.
    await expect(async () => {
      await page.goto(path);
      const title = path.startsWith("/uk") ? "Демо поділ" : "Split sample";
      const white = path.startsWith("/uk") ? "Білий" : "White";
      const blueName = path.startsWith("/uk") ? "Синій" : "Blue";
      await expect(card(page, `${title} — ${white}`)).toHaveCount(1);
      await expect(card(page, `${title} — ${blueName}`)).toHaveCount(1);
    }).toPass({ timeout: 90_000, intervals: [1000, 5000] });
  }

  await page.goto("/en/catalog");
  await waitForHydration(page);
  const white = card(page, "Split sample — White");
  await expect(
    white.getByRole("link", { name: "Choose options Split sample — White" }),
  ).toHaveAttribute("href", `/en/p/${slug}?opt.color=white`);
  await expect(white.getByRole("button")).toHaveCount(0);
  const link = white.getByRole("link", { name: "Split sample — White", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("group", { name: "Color", exact: true })
      .getByRole("radio", { name: "White", exact: true }),
  ).toBeChecked();
  await waitForHydration(page);
  await expect(
    page
      .getByRole("group", { name: "Product images" })
      .getByRole("img", { name: "Sample white", exact: true }),
  ).toBeVisible();
  const sizes = page.getByRole("group", { name: "Size", exact: true });
  await sizes.getByRole("radio", { name: "L", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(sizes.getByRole("radio", { name: "L", exact: true })).toBeChecked();
  await expect(
    page
      .getByRole("group", { name: "Color", exact: true })
      .getByRole("radio", { name: "White", exact: true }),
  ).toBeChecked();

  await page.goto("/en/catalog");
  await card(page, "Split sample — Blue")
    .getByRole("link", { name: "Split sample — Blue", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Color", exact: true })
      .getByRole("radio", { name: "Blue", exact: true }),
  ).toBeChecked();
  await expect(
    page
      .getByRole("group", { name: "Size", exact: true })
      .getByRole("radio", { name: "M", exact: true }),
  ).toBeChecked();
  await expect(
    page
      .getByRole("group", { name: "Product images" })
      .getByRole("img", { name: "Sample blue", exact: true }),
  ).toBeVisible();
  await page.goto("/en/catalog");
  await waitForHydration(page);
  await card(page, "Split sample — Blue")
    .getByRole("button", { name: "Add to cart Split sample — Blue" })
    .click();
  const drawer = page.getByRole("dialog", { name: /^Cart/ });
  await expect(drawer).toBeVisible();
  const cart = await call<{ lines: { variantId: string; quantity: number }[] }>(
    page.request,
    "GET",
    "/store/cart",
  );
  expect(
    cart.lines.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
  ).toEqual([{ variantId: split.blueVariantId, quantity: 1 }]);

  const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL: E2E_ORIGIN });
  try {
    const plain = await noJs.newPage();
    await plain.goto("/en/catalog?view=list");
    const add = card(plain, "Split sample — Blue").getByRole("link", {
      name: "Add to cart Split sample — Blue",
    });
    await expect(add).toHaveAttribute("href", `/en/p/${slug}?opt.color=blue`);
    await add.click();
    await expect(
      plain
        .getByRole("group", { name: "Color", exact: true })
        .getByRole("radio", { name: "Blue", exact: true }),
    ).toBeChecked();
  } finally {
    await noJs.close();
  }
});
