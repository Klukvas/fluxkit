import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";
import { buildContentSecurityPolicy, headerRules, securityHeaders } from "./next.config.js";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name as string, values] as const;
      }),
  );
}

describe("buildContentSecurityPolicy (production)", () => {
  const policy = directives(buildContentSecurityPolicy({ development: false, imageHosts: [] }));

  it("restricts everything to the origin by default", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
  });

  it("allows the inline scripts Next needs without nonces and without eval", () => {
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
    expect(policy.get("script-src")?.some((value) => value.startsWith("'nonce-"))).toBe(false);
  });

  it("allows inline styles (Next and Tailwind output) and nothing external", () => {
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("allows own and data: images, connections to the own origin only", () => {
    expect(policy.get("img-src")).toEqual(["'self'", "data:"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
  });

  it("forbids framing, a foreign base URI and foreign form targets", () => {
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("names no wildcard and no http: source", () => {
    const all = [...policy.values()].flat();
    expect(all).not.toContain("*");
    expect(all.some((value) => value === "http:" || value.startsWith("http://"))).toBe(false);
  });
});

describe("buildContentSecurityPolicy (development)", () => {
  const policy = directives(buildContentSecurityPolicy({ development: true, imageHosts: [] }));

  it("adds only what the dev server needs: eval for React's debugging and the HMR websocket", () => {
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(policy.get("connect-src")).toEqual(["'self'", "ws:", "wss:"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  });
});

describe("image hosts", () => {
  it("adds each configured host to img-src as an https origin", () => {
    const policy = directives(
      buildContentSecurityPolicy({
        development: false,
        imageHosts: ["cdn.example.com", "images.example.org"],
      }),
    );
    expect(policy.get("img-src")).toEqual([
      "'self'",
      "data:",
      "https://cdn.example.com",
      "https://images.example.org",
    ]);
  });

  it("refuses a host that could smuggle another directive or source", () => {
    for (const host of [
      "a.example; script-src *",
      "*.example.com",
      "https://x.example",
      "a b",
      "",
    ]) {
      expect(() => buildContentSecurityPolicy({ development: false, imageHosts: [host] })).toThrow(
        RangeError,
      );
    }
  });
});

describe("securityHeaders", () => {
  function byName(production: boolean) {
    const headers = securityHeaders({ development: !production, imageHosts: [] });
    return new Map(headers.map((header) => [header.key, header.value]));
  }

  it("sets the fixed headers for every environment", () => {
    for (const production of [true, false]) {
      const headers = byName(production);
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    }
  });

  it("sends Strict-Transport-Security in production only", () => {
    expect(byName(true).get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(byName(false).has("Strict-Transport-Security")).toBe(false);
  });

  it("emits each header once", () => {
    const keys = securityHeaders({ development: false, imageHosts: [] }).map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("headerRules: Referrer-Policy per page (Next's own matcher, last matching rule wins)", () => {
  function headersFor(pathname: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const rule of headerRules({ development: false, imageHosts: [] })) {
      if (getPathMatch(rule.source)(pathname) === false) continue;
      for (const header of rule.headers) result.set(header.key, header.value);
    }
    return result;
  }

  it("sends no Referer from the guest order page (its fragment holds the access token)", () => {
    for (const path of ["/uk/order/7K3M-9QX2", "/en/order/7k3m9qx2"]) {
      expect(headersFor(path).get("Referrer-Policy"), path).toBe("no-referrer");
      expect(headersFor(path).get("Content-Security-Policy"), path).toContain("default-src 'self'");
    }
  });

  it("sends no Referer from the pages of the emailed links (forgot password, reset password, verify email), in both locales", () => {
    for (const page of ["forgot-password", "reset-password", "verify-email"]) {
      for (const locale of ["uk", "en"]) {
        const headers = headersFor(`/${locale}/account/${page}`);
        expect(headers.get("Referrer-Policy"), `${locale} ${page}`).toBe("no-referrer");
        expect(headers.get("Content-Security-Policy"), `${locale} ${page}`).toContain(
          "default-src 'self'",
        );
      }
    }
  });

  it("sends no Referer from the payment return page, in both locales, and nowhere else under /payment", () => {
    for (const locale of ["uk", "en"]) {
      const headers = headersFor(`/${locale}/payment/return`);
      expect(headers.get("Referrer-Policy"), locale).toBe("no-referrer");
      expect(headers.get("Content-Security-Policy"), locale).toContain("default-src 'self'");
    }
    expect(headersFor("/uk/payment/other").get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("keeps the site-wide policy everywhere else, the checkout and the account orders included", () => {
    for (const path of [
      "/uk",
      "/uk/checkout",
      "/en/account/orders/7K3M-9QX2",
      "/uk/p/order",
      "/uk/orders",
      "/uk/account",
      "/uk/account/login",
      "/uk/account/profile",
      "/uk/account/reset-password/extra",
    ]) {
      expect(headersFor(path).get("Referrer-Policy"), path).toBe("strict-origin-when-cross-origin");
    }
  });
});

describe("no third-party origin and no cookie of its own (ADR 0033 decision 11)", () => {
  const imageHosts = ["cdn.example.com", "images.example.org"];

  it("lets the policy name nothing beyond the own origin, data: and the configured image hosts", () => {
    for (const development of [false, true]) {
      const policy = directives(buildContentSecurityPolicy({ development, imageHosts }));
      for (const [name, sources] of policy) {
        for (const source of sources) {
          const keyword = /^'(self|none|unsafe-inline|unsafe-eval)'$/.test(source);
          const scheme =
            source === "data:" || (development && (source === "ws:" || source === "wss:"));
          const imageHost =
            name === "img-src" && imageHosts.some((host) => source === `https://${host}`);
          expect(keyword || scheme || imageHost, `${name} ${source}`).toBe(true);
        }
      }
    }
  });

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = `${directory}/${name}`;
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
    });
  }
  const files = sourceFiles(fileURLToPath(new URL("./src", import.meta.url)));

  it("reads the source it scans (the checks below are not vacuous)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("never touches a cookie in the browser or on the server", () => {
    const offenders = files.filter((file) =>
      /document\.cookie|\bcookies\(\)|Set-Cookie/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("reads request headers in one place only: the results page's read of X-Forwarded-For, and nothing else (search plan step 10a)", () => {
    const readers = files.filter((file) => /next\/headers/.test(readFileSync(file, "utf8")));
    expect(readers.map((file) => file.slice(file.lastIndexOf("/src/") + 5))).toEqual([
      "lib/search-data.server.ts",
    ]);
    const text = readFileSync(readers[0] as string, "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      "",
    );
    // The single header read, handed to the address check; the cookie header and the cookie API stay out of reach.
    expect(text.match(/\bheaders\(\)/g)).toHaveLength(1);
    // Only through the address check, and only behind the operator's switch (review F1 and F5, ADR 0038). The behaviour
    // is pinned by `src/lib/search-data.server.spec.ts`; this keeps the one read readable as one line.
    expect(text).toMatch(
      /forwardClientAddress\s*\?\s*forwardableAddresses\(\(await headers\(\)\)\.get\("x-forwarded-for"\)\)\s*:\s*null/,
    );
    expect(text).not.toMatch(/cookie/i);
  });

  it("loads no third-party script, font or analytics", () => {
    const offenders = files.filter((file) =>
      /next\/font\/google|googletagmanager|google-analytics|gtag\(|fbq\(|<script[^>]+src=["']https?:/i.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
