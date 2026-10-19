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
  "[...rest]/page.tsx",
];

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
    // The home page checks the locale (already checked by the layout) and is the one page under (site)/loading.tsx.
    const offenders = pagesCallingNotFound(localeRoot)
      .filter((page) => loadingFilesAbove(page).length > 0)
      .map((page) => relative(localeRoot, page));
    expect(offenders).toEqual(["(site)/page.tsx"]);
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
        /^\(site\)\/(cart|checkout|account|order)\//.test(relative(localeRoot, page)) ||
        /^\(site\)\/(cart|checkout|account|order)$/.test(dirname(relative(localeRoot, page))),
    );
    expect(personal.map((page) => relative(localeRoot, page)).sort()).toEqual([
      "(site)/account/login/page.tsx",
      "(site)/account/orders/[number]/page.tsx",
      "(site)/account/orders/page.tsx",
      "(site)/account/page.tsx",
      "(site)/account/profile/page.tsx",
      "(site)/account/register/page.tsx",
      "(site)/cart/page.tsx",
      "(site)/checkout/page.tsx",
      "(site)/order/[number]/page.tsx",
    ]);
    for (const page of personal) {
      const source = readFileSync(page, "utf8");
      expect(source, relative(localeRoot, page)).toMatch(/return privateMetadata\(/);
      expect(source, relative(localeRoot, page)).not.toMatch(/robots:/);
    }
  });
});
