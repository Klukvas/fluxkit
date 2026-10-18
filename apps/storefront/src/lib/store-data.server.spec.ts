import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next request. It is the framework boundary here, so it is faked; everything else
// (the env parser, the client, the locale check) is real.
const events: string[] = [];
vi.mock("next/server", () => ({
  connection: async () => {
    events.push("connection");
  },
}));

const config = (locales: string[]) => ({
  currency: "UAH",
  currencyExponent: 2,
  pricesIncludeTax: true,
  defaultLocale: "uk",
  locales,
});

function stubApi(locales: string[]) {
  const fetchStub = vi.fn(async (url: string) => {
    events.push(`fetch ${new URL(url).pathname}`);
    return new Response(JSON.stringify(config(locales)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

beforeEach(() => {
  events.length = 0;
  vi.stubEnv("API_INTERNAL_URL", "http://api.internal:3000");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("store-data.server wiring", () => {
  it("waits for a real request before any API call, then reads API_INTERNAL_URL", async () => {
    const fetchStub = stubApi(["uk", "en"]);
    const { ensureStorefrontLocales } = await import("./store-data.server");
    await ensureStorefrontLocales();
    expect(events).toEqual(["connection", "fetch /store/config"]);
    expect(fetchStub.mock.calls[0]?.[0]).toBe("http://api.internal:3000/store/config");
  });

  it("fails loudly without a valid API_INTERNAL_URL, after the connection and before any request", async () => {
    const fetchStub = stubApi(["uk", "en"]);
    vi.stubEnv("API_INTERNAL_URL", "");
    const { ensureStorefrontLocales } = await import("./store-data.server");
    await expect(ensureStorefrontLocales()).rejects.toThrow(/API_INTERNAL_URL/);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("(site) layout", () => {
  it("renders its children when the API serves every storefront locale", async () => {
    stubApi(["uk", "en"]);
    const { default: SiteLayout } = await import("../app/[locale]/(site)/layout");
    await expect(SiteLayout({ children: "page" })).resolves.toBe("page");
  });

  it("does not render its children and logs when the API lacks a storefront locale", async () => {
    stubApi(["uk"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: SiteLayout } = await import("../app/[locale]/(site)/layout");
    await expect(SiteLayout({ children: "page" })).rejects.toThrow(/LOCALES/);
    expect(error).toHaveBeenCalled();
  });
});
