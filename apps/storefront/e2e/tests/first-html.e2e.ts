import { readLayoutShifts, watchLayoutShifts } from "../support/layout-shift.ts";
import { expect, test } from "../support/fixtures.ts";

/**
 * ADR 0048: the pages that must work before (or without) their script are in the FIRST HTML, not in a hidden segment that
 * only a script puts in place. React streams a page section separately (`<div hidden id="S:n">` plus an inline `$RC`
 * script) when a `loading.tsx` sits above the page and the page is not finished when the shell flushes, or when the HTML
 * before it passes 12 800 bytes (`progressiveChunkSize`). These checks read the raw HTML as the server sends it, so they
 * fail on either cause, whatever the size of the header and footer. `route-structure.spec.ts` keeps `loading.tsx` away from
 * these routes; this file proves the result. Each check also prints the byte sizes (`FIRST-HTML {...}`) for the ADR table.
 */

/** The page-level loading view (`LoadingView`, spinner label `loading.page`); it must not stand in for these pages. */
const LOADING_VIEW_LABEL = { en: "Loading the page", uk: "Завантаження сторінки" } as const;

/** Routes whose first HTML must hold a form of the page itself (not the header's search form). */
const FORM_ROUTES = [
  "/account/login",
  "/account/register",
  "/account/forgot-password",
  "/account/reset-password",
];

/** The other routes of `route-structure.spec.ts` `mustRenderBeforeHydration`: their server shell must be inline too. */
const SHELL_ROUTES = [
  "/account/verify-email",
  "/cart",
  "/checkout",
  "/legal/privacy",
  "/legal/terms",
  "/legal/cookies",
  "/payment/return",
  "/order/1000",
];

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** Byte offset of `needle` in `html`, or -1. */
function byteOffset(html: string, needle: string | RegExp, from = 0): number {
  const index =
    typeof needle === "string" ? html.indexOf(needle, from) : html.slice(from).search(needle);
  if (index < 0) return -1;
  return bytes(html.slice(0, typeof needle === "string" ? index : from + index));
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  return from < 0 || to < 0 ? "" : html.slice(from, to + end.length);
}

/** Every form of the page except the header's search form (`role="search"`). */
const PAGE_FORM = /<form(?![^>]*role="search")[\s>]/;

interface FirstHtml {
  route: string;
  status: number;
  total: number;
  head: number;
  header: number;
  footer: number;
  mainOffset: number;
  formOffset: number;
  footerEnd: number;
  outlinedSegments: number;
}

function measure(route: string, status: number, html: string): FirstHtml {
  const mainStart = html.indexOf("<main");
  return {
    route,
    status,
    total: bytes(html),
    head: bytes(between(html, "<head>", "</head>")),
    header: bytes(between(html, "<header", "</header>")),
    footer: bytes(between(html, "<footer", "</footer>")),
    mainOffset: byteOffset(html, "<main"),
    formOffset: mainStart < 0 ? -1 : byteOffset(html, PAGE_FORM, mainStart),
    footerEnd: byteOffset(html, "</footer>"),
    outlinedSegments: (html.match(/<div hidden id="S:/g) ?? []).length,
  };
}

for (const locale of ["uk", "en"] as const) {
  for (const path of [...FORM_ROUTES, ...SHELL_ROUTES]) {
    const route = `/${locale}${path}`;
    test(`${route}: the page is in the first HTML (no loading view, no hidden segment)`, async ({
      request,
    }) => {
      const response = await request.get(route);
      expect(response.status(), route).toBe(200);
      const html = await response.text();
      const facts = measure(route, response.status(), html);
      console.log(`FIRST-HTML ${JSON.stringify(facts)}`);

      const main = between(html, "<main", "</main>");
      expect(main, "the page has a <main> in the first HTML").not.toBe("");
      // A pending boundary in main means the page itself streams later; the loading view must never stand in for it.
      expect(main, "a pending Suspense boundary in <main>").not.toContain('<template id="B:');
      // As markup (`>label<`): the words themselves are also in the serialized client messages of every page.
      expect(html, "the route-level loading view").not.toContain(`>${LOADING_VIEW_LABEL[locale]}<`);
      // No hidden segment may carry a page form (the header's search box may stream, it is a GET form anyway).
      for (const segment of html.split('<div hidden id="S:').slice(1)) {
        expect(segment.split("</div><script>")[0], "a form inside a hidden segment").not.toMatch(
          PAGE_FORM,
        );
      }
      if (FORM_ROUTES.includes(path)) {
        expect(facts.formOffset, "the page's form is inside <main>").toBeGreaterThan(
          facts.mainOffset,
        );
        const mainEnd = byteOffset(html, "</main>");
        expect(facts.formOffset).toBeLessThan(mainEnd);
        // Nothing busy precedes the form: no loading view, no skeleton of a pending page.
        const beforeForm = main.slice(0, main.search(PAGE_FORM));
        expect(beforeForm, 'aria-busy="true" before the form').not.toContain('aria-busy="true"');
      }
    });
  }
}

/** CLS (ADR 0048, plan section 7): under 0.05 cold (new context, empty browser cache) and warm (reload). */
const CLS_PAGES = [
  { path: "/uk", ready: "main [data-hero]" },
  { path: "/uk/catalog", ready: "main h1" },
  { path: "/uk/account/register", ready: 'main form:not([role="search"])' },
  { path: "/en/account/register", ready: 'main form:not([role="search"])' },
] as const;

for (const width of [390, 1280]) {
  for (const { path, ready } of CLS_PAGES) {
    test(`${path} at ${width} px: layout shift under 0.05, cold and warm`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      await watchLayoutShifts(page, ready);
      const results: Record<string, number> = {};
      for (const run of ["cold", "warm"] as const) {
        if (run === "cold") await page.goto(path);
        else await page.reload();
        await expect(page.locator(ready).first()).toBeVisible();
        await page.waitForLoadState("load");
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(500);
        const shifts = await readLayoutShifts(page);
        const total = shifts.beforeReady + shifts.afterReady;
        results[run] = total;
        console.log(
          `CLS ${JSON.stringify({ path, width, run, total: Number(total.toFixed(4)), beforeReady: Number(shifts.beforeReady.toFixed(4)), afterReady: Number(shifts.afterReady.toFixed(4)) })}`,
        );
        expect(total, `${run}: ${shifts.sources.join(" | ")}`).toBeLessThan(0.05);
      }
      await context.close();
    });
  }
}
