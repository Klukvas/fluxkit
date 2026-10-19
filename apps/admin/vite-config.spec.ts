import type { UserConfig } from "vite";
import { describe, expect, it } from "vitest";
import config, { devApiUrl } from "./vite.config";

type ConfigFunction = (env: { command: "serve" | "build"; mode: string }) => UserConfig;

describe("vite config", () => {
  const build = (config as ConfigFunction)({ command: "build", mode: "production" });
  const serve = (config as ConfigFunction)({ command: "serve", mode: "development" });

  it("builds for the base path /admin-ui/ with a manifest", () => {
    expect(build.base).toBe("/admin-ui/");
    expect(build.build?.manifest).toBe(true);
  });

  it("proxies the API prefix in development, and never the SPA's own /admin-ui", () => {
    const keys = Object.keys(serve.server?.proxy ?? {});
    expect(keys).toHaveLength(1);
    const pattern = new RegExp(keys[0] as string);
    for (const path of ["/admin", "/admin/", "/admin/auth/me", "/admin?x=1"]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/admin-ui/", "/admin-ui/orders", "/administration", "/store/cart", "/"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });

  it("defaults the dev API to 127.0.0.1:3000 and refuses anything but an http(s) origin", () => {
    expect(devApiUrl(undefined)).toBe("http://127.0.0.1:3000");
    expect(devApiUrl("")).toBe("http://127.0.0.1:3000");
    expect(devApiUrl("http://localhost:4000/")).toBe("http://localhost:4000");
    for (const bad of [
      "localhost:3000",
      "ftp://x",
      "http://x/api",
      "http://x?y",
      "http://u:p@x",
      "nonsense",
    ]) {
      expect(() => devApiUrl(bad), bad).toThrow(/ADMIN_DEV_API_URL/);
    }
  });
});
