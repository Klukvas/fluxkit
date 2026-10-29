import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
    expect(ADMIN_SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(/unsafe-eval|\*|http:/);
  });

  it("allows inline style ATTRIBUTES for the mail preview and nothing else inline (step 11 decision)", () => {
    const policy = directives(ADMIN_SECURITY_HEADERS["Content-Security-Policy"] as string);
    expect(policy.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    // `unsafe-inline` appears in no other directive: scripts, style elements and the rest stay strict.
    for (const [name, sources] of policy) {
      if (name !== "style-src-attr") expect(sources, name).not.toContain("'unsafe-inline'");
    }
    // No directive that would allow an inline script, a style element, a frame or a sandboxed child to load something.
    for (const absent of [
      "script-src-elem",
      "script-src-attr",
      "style-src-elem",
      "frame-src",
      "child-src",
    ]) {
      expect(policy.has(absent), absent).toBe(false);
    }
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

describe("the admin app has no cookie of its own and loads nothing from a third party (ADR 0033 decision 11)", () => {
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

  it("never touches document.cookie", () => {
    expect(files.filter((file) => /document\.cookie/.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("keeps localStorage inside the language preference code (the language code is all it stores)", () => {
    const users = files.filter((file) => /localStorage/.test(readFileSync(file, "utf8")));
    expect(users.map((file) => file.slice(file.indexOf("/src/")))).toEqual([
      "/src/i18n/i18n-context.tsx",
      "/src/i18n/locale-preference.ts",
    ]);
  });

  it("loads no third-party script, font or analytics", () => {
    const offenders = files.filter((file) =>
      /googletagmanager|google-analytics|gtag\(|fbq\(|fonts\.googleapis|<script[^>]+src=["']https?:/i.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
