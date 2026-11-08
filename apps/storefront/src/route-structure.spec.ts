import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "app");
const localeRoot = join(appRoot, "[locale]");

/**
 * Finding of step 4b (Next 16.4.1, README "Rendering"): with a `loading.tsx` above a page, the shell streams first, so a
 * `notFound()` in the page can no longer change the HTTP status: an unknown product answers 200. Every route that can be
 * "not found" must therefore have NO `loading.tsx` in any directory above it.
 */
const mustAnswerRealNotFound = [
  "(catalog)/catalog/page.tsx",
  "(catalog)/c/[slug]/page.tsx",
  "(catalog)/p/[slug]/page.tsx",
  "(catalog)/search/page.tsx",
  // The shop pages (`config/shop-pages.ts`): an unknown or switched-off slug.
  "(pages)/[page]/page.tsx",
  "[...rest]/page.tsx",
];

/**
 * ADR 0048: the pages that must work before (or without) their script. With a `loading.tsx` above them React streams the
 * loading view in the shell and the page as a separate segment that only a script puts in place, whenever the page is not
 * finished when the shell flushes (a race) or the HTML before it passes 12 800 bytes (`progressiveChunkSize`). Without a
 * `loading.tsx` the page is part of the shell, so its form is always in the first HTML. The e2e `pre-hydration-forms` and
 * `first-html` tests check the result in a browser and in the raw HTML.
 */
const mustRenderBeforeHydration = [
  "(site)/account/login/page.tsx",
  "(site)/account/register/page.tsx",
  "(site)/account/forgot-password/page.tsx",
  "(site)/account/reset-password/page.tsx",
  "(site)/account/verify-email/page.tsx",
  "(site)/cart/page.tsx",
  "(site)/checkout/page.tsx",
  "(site)/legal/privacy/page.tsx",
  "(site)/legal/terms/page.tsx",
  "(site)/legal/cookies/page.tsx",
  "(site)/payment/return/page.tsx",
  "(site)/order/[number]/page.tsx",
];

function loadingFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return loadingFiles(path);
    return name === "loading.tsx" ? [relative(appRoot, path)] : [];
  });
}

function pagesCallingNotFound(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return pagesCallingNotFound(path);
    return name === "page.tsx" && readFileSync(path, "utf8").includes("notFound()") ? [path] : [];
  });
}

function loadingFilesAbove(page: string): string[] {
  const found: string[] = [];
  for (
    let directory = dirname(page);
    directory.startsWith(appRoot);
    directory = dirname(directory)
  ) {
    if (existsSync(join(directory, "loading.tsx"))) found.push(relative(appRoot, directory));
  }
  return found;
}

describe("route structure", () => {
  it.each(mustAnswerRealNotFound)("%s exists and has no loading.tsx above it", (route) => {
    const page = join(localeRoot, route);
    expect(existsSync(page), route).toBe(true);
    expect(loadingFilesAbove(page), `loading.tsx above ${route}`).toEqual([]);
  });

  it("keeps a loading.tsx only on pages that never call notFound() for missing content", () => {
    // The home page checks the locale (already checked by the layout) and is the one page under a loading.tsx.
    const offenders = pagesCallingNotFound(localeRoot)
      .filter((page) => loadingFilesAbove(page).length > 0)
      .map((page) => relative(localeRoot, page));
    expect(offenders).toEqual(["(site)/(home)/page.tsx"]);
  });

  it.each(mustRenderBeforeHydration)(
    "%s exists and has no loading.tsx above it (it must render before hydration, ADR 0048)",
    (route) => {
      const page = join(localeRoot, route);
      expect(existsSync(page), route).toBe(true);
      expect(loadingFilesAbove(page), `loading.tsx above ${route}`).toEqual([]);
    },
  );

  it("has exactly one loading view: the home page's own group (ADR 0048)", () => {
    // Home needs its script anyway (streamed sections); every other page renders inside the shell. A new loading.tsx is a
    // decision for ADR 0048 (it hides the page from a browser without a script), not a default.
    expect(loadingFiles(appRoot)).toEqual(["[locale]/(site)/(home)/loading.tsx"]);
    const home = readdirSync(join(localeRoot, "(site)", "(home)")).sort();
    expect(home).toEqual(["loading.tsx", "page.tsx"]);
  });

  it("gives every personal page (cart, checkout, account, order) the noindex metadata of privateMetadata", () => {
    const pages = (directory: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return pages(path);
        return name === "page.tsx" ? [path] : [];
      });
    const personal = pages(localeRoot).filter(
      (page) =>
        /^\(site\)\/(cart|checkout|account|order|payment)\//.test(relative(localeRoot, page)) ||
        /^\(site\)\/(cart|checkout|account|order|payment)$/.test(
          dirname(relative(localeRoot, page)),
        ),
    );
    expect(personal.map((page) => relative(localeRoot, page)).sort()).toEqual([
      "(site)/account/data/page.tsx",
      "(site)/account/deleted/page.tsx",
      "(site)/account/forgot-password/page.tsx",
      "(site)/account/login/page.tsx",
      "(site)/account/orders/[number]/page.tsx",
      "(site)/account/orders/page.tsx",
      "(site)/account/page.tsx",
      "(site)/account/profile/page.tsx",
      "(site)/account/register/page.tsx",
      "(site)/account/reset-password/page.tsx",
      "(site)/account/verify-email/page.tsx",
      "(site)/cart/page.tsx",
      "(site)/checkout/page.tsx",
      "(site)/order/[number]/page.tsx",
      "(site)/payment/return/page.tsx",
    ]);
    for (const page of personal) {
      const source = readFileSync(page, "utf8");
      expect(source, relative(localeRoot, page)).toMatch(/return privateMetadata\(/);
      expect(source, relative(localeRoot, page)).not.toMatch(/robots:/);
    }
  });

  it("reads nothing from the request in the three emailed-link pages (no searchParams, headers or cookies), sets no-referrer metadata and reads emailDelivery", () => {
    for (const name of ["forgot-password", "reset-password", "verify-email"]) {
      const page = join(localeRoot, "(site)", "account", name, "page.tsx");
      const source = readFileSync(page, "utf8");
      // The fragment is unknown to the server; nothing else a link could carry (a query, a header) is read either.
      expect(source, name).not.toMatch(/searchParams|headers\(|cookies\(/);
      expect(source, name).toMatch(/noReferrer: true/);
      expect(source, name).toMatch(/emailDelivery=\{await getEmailDelivery\(\)\}/);
    }
  });
});
