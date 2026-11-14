import type { BrowserContext, Page } from "@playwright/test";
import { E2E_ORIGIN } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { tabTo, waitForHydration } from "../support/flows.ts";
import { readLayoutShifts, watchLayoutShifts } from "../support/layout-shift.ts";
import { SHOP_NAME } from "../support/shop-name.ts";

/**
 * Desktop design, batch B (plan `docs/plans/2026-11-03-storefront-design-b.md`): the home page from `config/home.ts`, the
 * category banner, and the dark theme (server-rendered from the `fluxkit_theme` cookie, the system mode, the switch (the
 * header's `theme` control since round 4)
 * with and without a script, contrast of what a shopper sees in dark).
 */

const DESKTOP = { width: 1280, height: 800 };
test.use({ viewport: DESKTOP });

// `--fk-color-background` of tokens.css (playful default, plan 2026-11-14): cream `#fff3e3` and dark brown `#1f130d`.
const LIGHT_BACKGROUND = "rgb(255, 243, 227)";
const DARK_BACKGROUND = "rgb(31, 19, 13)";

async function setThemeCookie(context: BrowserContext, value: string): Promise<void> {
  await context.addCookies([{ name: "fluxkit_theme", value, url: E2E_ORIGIN }]);
}

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const sectionIds = (page: Page) =>
  page
    .locator("main [data-home-section-id]")
    .evaluateAll((sections) =>
      sections.map((section) => section.getAttribute("data-home-section-id")),
    );

test("the home page shows the configured sections in order, one h1, the hero picture and no layout shift", async ({
  page,
}) => {
  // Layout shifts before and after the page itself is on screen (its hero is visible). Before it, the home loading view may
  // be painted first and then replaced by the page (it moved the footer by 0.26 before `LoadingView` got a screen's height).
  await watchLayoutShifts(page, "main [data-hero]");
  await page.goto("/en");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Welcome" })).toBeVisible();
  await expect(main.locator("h1")).toHaveCount(1);
  await expect(main.locator("[data-hero]").first()).toBeVisible();
  const hero = main.locator('[data-hero] img[src="/home/hero.svg"]');
  await expect(hero).toHaveAttribute("width", "640");
  await expect(hero).toHaveAttribute("height", "480");
  await expect(hero).toHaveAttribute("fetchpriority", "high");
  await expect(main.getByRole("link", { name: /^Clothing/ })).toHaveAttribute(
    "href",
    "/en/c/demo-clothing",
  );
  await expect(main.getByRole("link", { name: /^Clothing/ })).toContainText("2 subcategories");
  const products = main.getByRole("list", { name: "New arrivals" });
  await expect(products.getByRole("listitem")).toHaveCount(8);
  // Read once the streamed sections are in (a skeleton has the section's h2 but no product h3 yet).
  expect(await sectionIds(page)).toEqual([
    "home-banners",
    "home-categories",
    "home-new-products",
    "home-trust",
    "home-about",
  ]);
  const headings = await main
    .locator("h1, h2, h3")
    .evaluateAll((elements) => elements.map((element) => element.tagName));
  // The hero's h1, the banners' hidden h2 and an h3 per seeded card banner (the third, a picture banner, has no heading:
  // its alt text names its link), the category tiles' h2, the product row's h2 and h3.
  expect(headings.slice(0, 7)).toEqual(["H1", "H2", "H3", "H3", "H2", "H2", "H3"]);
  // Below the hero: no product image of the home row is fetched eagerly.
  expect(
    await products
      .locator("img")
      .evaluateAll((images) => images.map((image) => image.getAttribute("loading"))),
  ).not.toContain("eager");
  await expect(main.getByRole("link", { name: "All products" })).toHaveAttribute(
    "href",
    "/en/catalog",
  );
  await expect(main.getByRole("list", { name: "About your purchase" })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: "About the shop" })).toBeVisible();

  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(500);
  const {
    afterReady: shift,
    sources: shiftSources,
    beforeReady: loadingViewShift,
  } = await readLayoutShifts(page);
  expect(shift, `layout shift after the page appeared: ${shiftSources.join(" | ")}`).toBeLessThan(
    0.05,
  );
  // The loading view is at least a screen tall (`LoadingView`), so replacing it moves nothing on screen either.
  expect(loadingViewShift, "layout shift while the loading view was replaced").toBeLessThan(0.05);
});

for (const width of [1280, 1024, 768, 390]) {
  test(`the home page fits ${width} px without sideways scrolling, hero text before its picture`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/uk");
    await expect(page.getByRole("heading", { level: 1, name: "Ласкаво просимо" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
    const picture = await page.locator('[data-hero] img[src="/home/hero.svg"]').boundingBox();
    expect(heading).not.toBeNull();
    expect(picture).not.toBeNull();
    if (width >= 768) {
      // Side by side: the picture is to the right of the text.
      expect((picture?.x ?? 0) >= (heading?.x ?? 0) + (heading?.width ?? 0) - 1).toBe(true);
    } else {
      expect((picture?.y ?? 0) > (heading?.y ?? 0)).toBe(true);
    }
  });
}

test("a category page shows its name and description as a banner (config/category-page.ts)", async ({
  page,
}) => {
  await page.goto("/en/c/demo-clothing");
  const banner = page.getByRole("main").locator("[data-hero]");
  await expect(banner.getByRole("heading", { level: 1, name: "Clothing" })).toBeVisible();
  await expect(page.getByRole("main").locator("h1")).toHaveCount(1);
});

test("the server renders the theme from the cookie (no flash: the attribute is in the first HTML)", async ({
  page,
}) => {
  const html = async (cookie: string | null) =>
    (await page.request.get("/en", { headers: cookie === null ? {} : { cookie } })).text();
  expect(await html(null)).toMatch(/<html lang="en" data-theme="system"/);
  expect(await html("fluxkit_theme=dark")).toMatch(/<html lang="en" data-theme="dark"/);
  expect(await html("fluxkit_theme=light")).toMatch(/<html lang="en" data-theme="light"/);
  expect(await html("fluxkit_theme=<script>")).toMatch(/<html lang="en" data-theme="system"/);
  // The CSS alone paints the chosen theme: with the script off the page is dark from the server's attribute.
  const browser = page.context().browser();
  if (browser === null) throw new Error("no browser");
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, javaScriptEnabled: false });
  await setThemeCookie(context, "dark");
  const noScript = await context.newPage();
  await noScript.goto("/en/catalog");
  expect(await bodyBackground(noScript)).toBe(DARK_BACKGROUND);
  expect(
    await noScript.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
  ).toBe("dark");
  await context.close();
});

test("the system mode follows the device's colour scheme, also when it changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
  // A fixed choice wins over the device.
  await setThemeCookie(page.context(), "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
});

test("the header's theme control works by keyboard, says which theme is on, and the choice survives a reload", async ({
  page,
  context,
}) => {
  await page.goto("/en/catalog");
  await waitForHydration(page);
  // Round 4: the switch is the header's `theme` control (a disclosure); its panel holds the three buttons.
  const control = page.getByRole("banner").getByRole("button", { name: "Theme", exact: true });
  const group = page.getByRole("group", { name: "Theme" });
  const dark = group.getByRole("button", { name: "Dark" });
  const light = group.getByRole("button", { name: "Light" });
  const system = group.getByRole("button", { name: "System" });

  await tabTo(page, control, 80);
  await page.keyboard.press("Enter");
  await expect(control).toHaveAttribute("aria-expanded", "true");
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(dark).toHaveAttribute("aria-pressed", "false");

  await tabTo(page, dark, 10);
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(system).toHaveAttribute("aria-pressed", "false");
  expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);
  // Applied in place: still the same page, nothing posted.
  expect(page.url()).toBe(`${E2E_ORIGIN}/en/catalog`);
  const cookie = (await context.cookies()).find((entry) => entry.name === "fluxkit_theme");
  expect(cookie?.value).toBe("dark");
  expect(cookie?.path).toBe("/");
  expect(cookie?.sameSite).toBe("Lax");

  // Escape closes the panel and gives the focus back to the control.
  await page.keyboard.press("Escape");
  await expect(control).toHaveAttribute("aria-expanded", "false");
  await expect(control).toBeFocused();

  await page.reload();
  await waitForHydration(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await control.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");

  await light.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
});

test("without a script the switch posts the choice and comes back to the same page", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/uk/catalog");
  // The header's `theme` control is a native `<details>`: it opens without a script.
  const control = page.getByRole("banner").getByRole("button", { name: "Тема", exact: true });
  await control.click();
  await page.getByRole("group", { name: "Тема" }).getByRole("button", { name: "Темна" }).click();
  await expect(page).toHaveURL(`${E2E_ORIGIN}/uk/catalog`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);
  await control.click();
  await expect(
    page.getByRole("group", { name: "Тема" }).getByRole("button", { name: "Темна" }),
  ).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

/**
 * Every visible text on the page against its effective background (the first opaque background up the tree), WCAG 2.x;
 * and the border of every text field against its background. Disabled and transparent-by-opacity elements are left out
 * (WCAG exempts inactive controls). Returns the failures.
 */
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] | null => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (!match) return null;
      const parts = (match[1] as string)
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const luminance = ([r, g, b]: number[]) => {
      const channel = (value: number) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
    };
    const ratio = (a: number[], b: number[]) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (high + 0.05) / (low + 0.05);
    };
    const background = (element: Element | null): number[] => {
      for (let node = element; node !== null; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color[3] >= 0.99) return color;
      }
      return parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    };
    const hidden = (element: Element) => {
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 1)
          return true;
        if (node.matches(":disabled, [aria-disabled='true']")) return true;
      }
      const box = element.getBoundingClientRect();
      return box.width <= 1 || box.height <= 1;
    };
    const failures: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      const element = text.parentElement;
      if (element === null || seen.has(element) || (text.textContent ?? "").trim() === "") continue;
      seen.add(element);
      if (element.closest("script, style, noscript, svg, [data-nextjs-toast], nextjs-portal"))
        continue;
      if (hidden(element)) continue;
      const color = parse(getComputedStyle(element).color);
      if (!color) continue;
      const measured = ratio(color, background(element));
      if (measured < 4.5) {
        failures.push(
          `${measured.toFixed(2)} "${(text.textContent ?? "").trim().slice(0, 30)}" <${element.tagName.toLowerCase()} class="${element.className}">`,
        );
      }
    }
    for (const field of document.querySelectorAll(
      "input:not([type=hidden]):not([type=radio]), select, textarea",
    )) {
      if (hidden(field)) continue;
      const border = parse(getComputedStyle(field).borderTopColor);
      if (!border) continue;
      const measured = ratio(border, background(field.parentElement));
      if (measured < 3)
        failures.push(
          `${measured.toFixed(2)} border of <${field.tagName.toLowerCase()} name="${field.getAttribute("name") ?? ""}">`,
        );
    }
    return failures;
  });
}

test("in dark, the text of the home, product, cart, checkout and shop pages keeps its contrast (computed colours)", async ({
  page,
  context,
  shopper,
}) => {
  await setThemeCookie(context, "dark");
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);
  for (const path of [
    "/en",
    "/uk",
    "/en/p/demo-t-shirt",
    "/en/c/demo-tools",
    "/en/cart",
    "/en/checkout",
    // The shop pages (repair batch 2): tables, the FAQ, the contacts and the footer's new lists.
    "/en/delivery-and-payment",
    "/uk/returns",
    "/en/faq",
    "/uk/about",
    "/en/size-guide",
    "/uk/contacts",
  ]) {
    await page.goto(path);
    if (path.startsWith("/en")) await waitForHydration(page);
    else await expect(page.getByRole("link", { name: /Кошик.*\d+/ })).toBeVisible();
    expect(await bodyBackground(page), path).toBe(DARK_BACKGROUND);
    // The home walk includes the seeded banners of the admin (plan 2026-11-05-admin-home-banners.md): a card in the accent
    // and one in the surface tone, and the picture banner (no text of its own).
    if (path === "/en" || path === "/uk") {
      await expect(page.locator('main [data-home-section="banners"] li')).toHaveCount(3);
    }
    expect(await contrastFailures(page), path).toEqual([]);
  }
  // Focus ring: the ring token on the dark page.
  await page.goto("/en/cart");
  await waitForHydration(page);
  const link = page.getByRole("link", { name: SHOP_NAME.en });
  await link.focus();
  const ring = await link.evaluate((element) => getComputedStyle(element).outlineColor);
  // `--fk-color-ring` of the dark theme, `#ff7959`.
  expect(ring).toBe("rgb(255, 121, 89)");
});

test("in light, the same pages keep their contrast too (the check itself finds a real failure)", async ({
  page,
}) => {
  await page.goto("/en/p/demo-t-shirt");
  await waitForHydration(page);
  expect(await contrastFailures(page)).toEqual([]);
  // The checker is not vacuous: grey on grey fails.
  await page.evaluate(() => {
    const probe = document.createElement("p");
    probe.textContent = "probe";
    probe.style.color = "rgb(200, 200, 200)";
    document.querySelector("main")?.append(probe);
  });
  expect((await contrastFailures(page)).some((failure) => failure.includes('"probe"'))).toBe(true);
});
