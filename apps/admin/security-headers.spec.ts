import { describe, expect, it } from "vitest";
import {
  ADMIN_CACHE_CONTROL,
  ADMIN_SECURITY_HEADERS,
  adminContentSecurityPolicy,
  adminSecurityHeaders,
} from "./security-headers";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name as string, sources];
    }),
  );
}

describe("admin security headers (ADR 0027 decision 3)", () => {
  it("allows scripts, styles and requests from the own origin only, with no inline or eval escape", () => {
    const policy = directives(ADMIN_SECURITY_HEADERS["Content-Security-Policy"] as string);
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual(["'self'"]);
    expect(policy.get("style-src")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:"]);
    expect(ADMIN_SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(
      /unsafe-inline|unsafe-eval|\*|http:/,
    );
  });

  it("forbids framing, sniffing and the referrer", () => {
    expect(ADMIN_SECURITY_HEADERS).toMatchObject({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("adds image hosts as https origins and refuses anything but a bare host name", () => {
    const policy = directives(adminContentSecurityPolicy({ imageHosts: ["cdn.example.com"] }));
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "https://cdn.example.com"]);
    for (const bad of [
      "https://cdn.example.com",
      "*.example.com",
      "cdn.example.com:8443",
      "a b",
      "x;y",
    ]) {
      expect(() => adminSecurityHeaders({ imageHosts: [bad] }), bad).toThrow(RangeError);
    }
  });

  it("revalidates the HTML and caches the hashed assets for good", () => {
    expect(ADMIN_CACHE_CONTROL).toEqual({
      html: "no-cache",
      assets: "public, max-age=31536000, immutable",
    });
  });
});
