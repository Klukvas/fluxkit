import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { E2E_ORIGIN } from "../env.ts";
import {
  CART_VARIANT_SKU,
  FROZEN_TIME,
  PRODUCT_SLUG,
  THEME_COOKIE,
  type Theme,
  type VisualPage,
} from "./pages.ts";
import type { SelectorSpec, SelectorStep } from "./selectors.ts";
import { COMPUTED_PROPERTIES, type ElementStyles } from "./snapshot.ts";

/**
 * Browser side of the visual harness: freezing a page, waiting until it is settled, locating the fixed selectors and
 * reading their computed styles. Depends only on `../env.ts` (stable), because `scripts/visual-compare.sh` copies this
 * harness into the BASE tree and runs it there against the base's own app.
 */

/** Every state-changing store request carries this header (docs/api/customers.md). */
const CSRF = { "X-Fluxkit-CSRF": "1" } as const;

export async function setTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await context.addCookies([{ name: THEME_COOKIE, value: theme, url: E2E_ORIGIN }]);
}

/** Puts one line (`CART_VARIANT_SKU`, quantity 1) into the cart of the browser's cookie jar, through the store API. */
export async function addCartLine(page: Page): Promise<void> {
  const productResponse = await page.request.get(`/store/products/${PRODUCT_SLUG}`);
  expect(productResponse.status(), await productResponse.text()).toBe(200);
  const product = (await productResponse.json()) as { variants: { id: string; sku: string }[] };
  const variant = product.variants.find((candidate) => candidate.sku === CART_VARIANT_SKU);
  if (variant === undefined) {
    throw new Error(`The test fixture has no variant ${CART_VARIANT_SKU} on ${PRODUCT_SLUG}.`);
  }
  const added = await page.request.post("/store/cart/items", {
    headers: CSRF,
    data: { variantId: variant.id, quantity: 1 },
  });
  expect([200, 201], await added.text()).toContain(added.status());
}

/**
 * Installs the frozen clock (scripts on only: without scripts there is no clock to fake) and, for a `cart-line` page, fills
 * the cart; call before `goto`.
 */
export async function preparePage(
  page: Page,
  target: VisualPage,
  javaScript = true,
): Promise<void> {
  if (javaScript) await page.clock.install({ time: FROZEN_TIME });
  if (target.setup === "cart-line") await addCartLine(page);
}

/**
 * Waits until the page is settled: loaded, fonts ready, hydrated (React has attached itself to the main landmark), no
 * pending streamed boundary, no `[aria-busy="true"]` region, and the network quiet. Then the focus is dropped, so an
 * auto-focused field does not paint a focus ring on one side only.
 */
export async function settle(page: Page, javaScript = true): Promise<void> {
  await page.waitForLoadState("load");
  if (javaScript) {
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => {
      const main = document.querySelector("main");
      if (main === null) return false;
      const hydrated = Object.keys(main).some((key) => key.startsWith("__reactFiber$"));
      // `<!--$?-->` marks a Suspense boundary whose content has not streamed in yet.
      const pending = document.body.innerHTML.includes("<!--$?-->");
      return hydrated && !pending && document.querySelector('[aria-busy="true"]') === null;
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      (document.activeElement as HTMLElement | null)?.blur();
    });
    // Two frames: layout and paint after the last state change.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        }),
    );
  }
}

function applyStep(base: Page | Locator, step: SelectorStep): Locator {
  if ("role" in step) {
    return base.getByRole(step.role, {
      ...(step.name === undefined ? {} : { name: new RegExp(step.name) }),
      ...(step.level === undefined ? {} : { level: step.level }),
    });
  }
  if ("css" in step) return base.locator(step.css);
  return base.getByText(new RegExp(step.text));
}

/** The first visible element an entry of `selectors.ts` describes (the locator may match nothing). */
export function locate(page: Page, spec: SelectorSpec): Locator {
  let current: Page | Locator =
    spec.scope === "page" ? page : page.getByRole(spec.scope).filter({ visible: true }).first();
  for (const step of spec.steps) {
    current = applyStep(current, step).filter({ visible: true }).first();
  }
  return current as Locator;
}

/** The computed styles of an entry's element, or `null` when the page has no visible match. */
export async function computedStylesOf(page: Page, spec: SelectorSpec): Promise<ElementStyles> {
  const locator = locate(page, spec);
  if ((await locator.count()) === 0) return null;
  return locator.evaluate(
    (element, properties) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        properties.map((property) => [property, style.getPropertyValue(property)]),
      );
    },
    [...COMPUTED_PROPERTIES],
  );
}
