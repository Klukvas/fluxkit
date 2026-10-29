import { describe, expect, it } from "vitest";
import { DEFAULT_STOREFRONT_PUBLIC_URL, loadStorefrontEnv } from "./index.js";

const base = { API_INTERNAL_URL: "http://127.0.0.1:3000" };

describe("loadStorefrontEnv API_INTERNAL_URL", () => {
  it("is required", () => {
    expect(() => loadStorefrontEnv({})).toThrow(/Invalid storefront environment: API_INTERNAL_URL/);
    expect(() => loadStorefrontEnv({ API_INTERNAL_URL: "" })).toThrow(/API_INTERNAL_URL/);
    expect(() => loadStorefrontEnv({ API_INTERNAL_URL: "   " })).toThrow(/API_INTERNAL_URL/);
  });

  it("accepts http and https origins and normalizes a trailing slash away", () => {
    expect(loadStorefrontEnv(base).apiInternalUrl).toBe("http://127.0.0.1:3000");
    expect(loadStorefrontEnv({ API_INTERNAL_URL: "http://api:3000/" }).apiInternalUrl).toBe(
      "http://api:3000",
    );
    expect(loadStorefrontEnv({ API_INTERNAL_URL: "https://api.internal" }).apiInternalUrl).toBe(
      "https://api.internal",
    );
  });

  it("rejects other schemes, paths, queries, fragments and credentials", () => {
    const rejected = [
      "ftp://api:3000",
      "api:3000",
      "//api:3000",
      "javascript:alert(1)",
      "http://api:3000/store",
      "http://api:3000/v1/",
      "http://api:3000?x=1",
      "http://api:3000/#frag",
      "http://user:pass@api:3000",
      "not a url",
      "http://",
    ];
    for (const value of rejected) {
      expect(() => loadStorefrontEnv({ API_INTERNAL_URL: value }), value).toThrow(
        /API_INTERNAL_URL/,
      );
    }
  });
});

describe("loadStorefrontEnv STOREFRONT_PUBLIC_URL", () => {
  it("defaults to localhost:3001 when NODE_ENV is not production", () => {
    expect(DEFAULT_STOREFRONT_PUBLIC_URL).toBe("http://localhost:3001");
    expect(loadStorefrontEnv(base).storefrontPublicUrl).toBe("http://localhost:3001");
    expect(loadStorefrontEnv({ ...base, NODE_ENV: "development" }).storefrontPublicUrl).toBe(
      "http://localhost:3001",
    );
    expect(loadStorefrontEnv({ ...base, NODE_ENV: "test" }).storefrontPublicUrl).toBe(
      "http://localhost:3001",
    );
  });

  it("is required when NODE_ENV is production, whatever the casing or spacing", () => {
    for (const nodeEnv of ["production", "Production", " PRODUCTION "]) {
      expect(() => loadStorefrontEnv({ ...base, NODE_ENV: nodeEnv })).toThrow(
        /STOREFRONT_PUBLIC_URL/,
      );
      expect(() =>
        loadStorefrontEnv({ ...base, NODE_ENV: nodeEnv, STOREFRONT_PUBLIC_URL: "" }),
      ).toThrow(/STOREFRONT_PUBLIC_URL/);
      expect(
        loadStorefrontEnv({
          ...base,
          NODE_ENV: nodeEnv,
          STOREFRONT_PUBLIC_URL: "https://shop.example",
        }).storefrontPublicUrl,
      ).toBe("https://shop.example");
    }
  });

  it("is an origin: no path, query, fragment or credentials; a trailing slash is dropped", () => {
    expect(
      loadStorefrontEnv({ ...base, STOREFRONT_PUBLIC_URL: "https://shop.example/" })
        .storefrontPublicUrl,
    ).toBe("https://shop.example");
    for (const value of [
      "shop.example",
      "ftp://shop.example",
      "https://shop.example/uk",
      "https://shop.example?a=1",
      "https://shop.example#x",
      "https://u:p@shop.example",
    ]) {
      expect(() => loadStorefrontEnv({ ...base, STOREFRONT_PUBLIC_URL: value }), value).toThrow(
        /STOREFRONT_PUBLIC_URL/,
      );
    }
  });
});

describe("loadStorefrontEnv STOREFRONT_IMAGE_HOSTS", () => {
  it("is empty when unset or blank", () => {
    expect(loadStorefrontEnv(base).imageHosts).toEqual([]);
    expect(loadStorefrontEnv({ ...base, STOREFRONT_IMAGE_HOSTS: "  " }).imageHosts).toEqual([]);
  });

  it("parses a comma list, trimming, lowercasing and removing duplicates", () => {
    expect(
      loadStorefrontEnv({
        ...base,
        STOREFRONT_IMAGE_HOSTS: " Cdn.Example.com, images.example.org ,cdn.example.com,localhost",
      }).imageHosts,
    ).toEqual(["cdn.example.com", "images.example.org", "localhost"]);
  });

  it("rejects schemes, paths, ports, wildcards, empty entries, spaces and invalid labels", () => {
    const rejected = [
      "https://cdn.example.com",
      "cdn.example.com/images",
      "cdn.example.com:8080",
      "*.example.com",
      "**",
      "a.com,,b.com",
      "a.com,",
      "cdn example.com",
      "-bad.example.com",
      "bad-.example.com",
      "bad..example.com",
      "user@cdn.example.com",
      "cdn.example.com?x=1",
      "cdn_underscore.example.com",
    ];
    for (const value of rejected) {
      expect(() => loadStorefrontEnv({ ...base, STOREFRONT_IMAGE_HOSTS: value }), value).toThrow(
        /STOREFRONT_IMAGE_HOSTS/,
      );
    }
  });
});

describe("loadStorefrontEnv errors", () => {
  it("does not echo rejected values or other variables", () => {
    try {
      loadStorefrontEnv({
        API_INTERNAL_URL: "http://user:hunter2@api:3000/secret-path",
        STOREFRONT_PUBLIC_URL: "https://shop.example/private-path",
        STOREFRONT_IMAGE_HOSTS: "https://leak.example/img",
        NODE_ENV: "development",
        DATABASE_URL: "postgres://user:db-password@db/x",
      });
      expect.unreachable("expected loadStorefrontEnv to throw");
    } catch (error) {
      const message = String(error);
      for (const leaked of [
        "hunter2",
        "secret-path",
        "private-path",
        "leak.example",
        "db-password",
      ]) {
        expect(message).not.toContain(leaked);
      }
      expect(message).toMatch(/API_INTERNAL_URL/);
      expect(message).toMatch(/STOREFRONT_PUBLIC_URL/);
      expect(message).toMatch(/STOREFRONT_IMAGE_HOSTS/);
    }
  });

  it("reads only its own variables", () => {
    expect(
      loadStorefrontEnv({ ...base, DATABASE_URL: "not checked", TRUST_PROXY: "garbage" }),
    ).toEqual({
      apiInternalUrl: "http://127.0.0.1:3000",
      storefrontPublicUrl: "http://localhost:3001",
      imageHosts: [],
      forwardClientAddress: false,
    });
  });
});

describe("loadStorefrontEnv STOREFRONT_FORWARD_CLIENT_ADDRESS (ADR 0038)", () => {
  it("is off when unset or blank: the Next server passes no client header on unless the operator says so", () => {
    expect(loadStorefrontEnv(base).forwardClientAddress).toBe(false);
    expect(
      loadStorefrontEnv({ ...base, STOREFRONT_FORWARD_CLIENT_ADDRESS: "" }).forwardClientAddress,
    ).toBe(false);
    expect(
      loadStorefrontEnv({ ...base, STOREFRONT_FORWARD_CLIENT_ADDRESS: "  " }).forwardClientAddress,
    ).toBe(false);
    expect(
      loadStorefrontEnv({ ...base, STOREFRONT_FORWARD_CLIENT_ADDRESS: "false" })
        .forwardClientAddress,
    ).toBe(false);
  });

  it("is on only for exactly true", () => {
    expect(
      loadStorefrontEnv({ ...base, STOREFRONT_FORWARD_CLIENT_ADDRESS: "true" })
        .forwardClientAddress,
    ).toBe(true);
  });

  it.each(["TRUE", "True", "1", "yes", "on", "true ", "no"])(
    "refuses %j loudly instead of guessing (a typo in a trust switch must not pick a side)",
    (value) => {
      expect(() =>
        loadStorefrontEnv({ ...base, STOREFRONT_FORWARD_CLIENT_ADDRESS: value }),
      ).toThrow(/Invalid storefront environment: STOREFRONT_FORWARD_CLIENT_ADDRESS/);
    },
  );
});
