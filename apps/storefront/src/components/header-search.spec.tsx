import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadSearchEnabled } from "../lib/catalog-data";
import type { CatalogOutcome, StoreData } from "../lib/store-data";
import uk from "../messages/uk.json";
import { SiteShell } from "./site-shell";
import { sentinelTranslator } from "./test-helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/uk",
  useSearchParams: () => new URLSearchParams(),
}));

const t = sentinelTranslator();
const messages = Object.fromEntries(Object.keys(uk).map((key) => [key, `§${key}`]));

function shell(searchEnabled: boolean): string {
  return renderToStaticMarkup(
    <SiteShell
      locale="uk"
      messages={messages}
      t={t}
      categories={[]}
      searchEnabled={searchEnabled}
      year={2026}
    >
      §child
    </SiteShell>,
  );
}

describe("the header's search box and the shop's search setting (availability gating)", () => {
  it("renders the search box in the header when the shop has search, before the locale switcher, once", () => {
    const html = shell(true);
    expect(html.match(/role="search"/g)).toHaveLength(1);
    expect(html.indexOf('role="search"')).toBeGreaterThan(html.indexOf("<header"));
    expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf("</header>"));
    expect(html).toContain('action="/uk/search"');
  });

  it("renders NO search box, form or search link when search is off", () => {
    const html = shell(false);
    expect(html).not.toContain('role="search"');
    expect(html).not.toContain("/uk/search");
    expect(html).not.toContain("searchBox.");
    expect(html).not.toContain('role="combobox"');
  });

  it("passes the setting through to the header from the locale layout's config read, and nowhere else decides it", () => {
    const root = join(import.meta.dirname, "..");
    const layout = readFileSync(join(root, "app", "[locale]", "layout.tsx"), "utf8");
    expect(layout).toMatch(/const searchEnabled = await headerSearchEnabled\(\);/);
    expect(layout).toMatch(/searchEnabled=\{searchEnabled\}/);
    const header = readFileSync(join(root, "components", "site-header.tsx"), "utf8");
    expect(header).toMatch(/\{searchEnabled \? \(/);
  });
});

function configOf(search: boolean): StoreData {
  const outcome = {
    ok: true,
    stale: false,
    data: {
      currency: "UAH",
      currencyExponent: 2,
      pricesIncludeTax: true,
      defaultLocale: "uk",
      locales: ["uk", "en"],
      emailDelivery: true,
      onlinePayment: false,
      search,
    },
  } satisfies CatalogOutcome<unknown>;
  return { getConfig: async () => outcome } as unknown as StoreData;
}

describe("loadSearchEnabled", () => {
  it("is the search flag of GET /store/config, true and false", async () => {
    await expect(loadSearchEnabled(configOf(true))).resolves.toBe(true);
    await expect(loadSearchEnabled(configOf(false))).resolves.toBe(false);
  });

  it("does not guess when the config is refused: it throws, so the page's error view renders", async () => {
    const refused = {
      getConfig: async () => ({
        ok: false,
        status: 500,
        problem: { type: "t", title: "t", status: 500, code: "internal_error", detail: "d" },
      }),
    } as unknown as StoreData;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(loadSearchEnabled(refused)).rejects.toThrow(/GET \/store\/config answered 500/);
  });
});

describe("the results route", () => {
  const root = join(import.meta.dirname, "..", "app", "[locale]", "(catalog)", "search");
  const page = readFileSync(join(root, "page.tsx"), "utf8");

  it("answers a real 404 when search is off, before it reads anything else, and renders no search when off", () => {
    expect(page.indexOf("getSearchEnabled()")).toBeGreaterThan(-1);
    expect(page).toMatch(/if \(!\(await getSearchEnabled\(\)\)\) notFound\(\);/);
    expect(page.indexOf("getSearchEnabled()")).toBeLessThan(page.indexOf("parseSearchParams("));
    expect(page).toMatch(/outcome\.kind === "disabled"\) notFound\(\)/);
  });

  it("is noindex through searchMetadata and takes the address, not a cache, as the state", () => {
    expect(page).toMatch(/return searchMetadata\(/);
    expect(page).not.toMatch(/unstable_cache|revalidate/);
  });
});
