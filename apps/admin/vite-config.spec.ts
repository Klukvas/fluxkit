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

  it("proxies the API prefixes in development, and never the SPA's own /admin-ui", () => {
    const proxy = serve.server?.proxy ?? {};
    const keys = Object.keys(proxy);
    expect(keys).toHaveLength(2);
    const matching = (path: string) =>
      keys.filter((key) => new RegExp(key).test(path)).map((key) => key.replace(/\W/g, ""));
    for (const path of ["/admin", "/admin/", "/admin/auth/me", "/admin?x=1"]) {
      expect(matching(path), path).toEqual(["admin"]);
    }
    for (const path of [
      "/media",
      "/media/",
      "/media/0123456789abcdef0123456789abcdef.jpg",
      "/media/..%2f..%2fetc%2fpasswd",
      "/media?x=1",
    ]) {
      expect(matching(path), path).toEqual(["media"]);
    }
    for (const path of [
      "/admin-ui/",
      "/admin-ui/orders",
      "/administration",
      "/media-library",
      "/store/cart",
      "/",
    ]) {
      expect(matching(path), path).toEqual([]);
    }
  });

  it("sends /admin and /media to the same target, with the browser's Host header", () => {
    for (const config of [serve.server?.proxy, serve.preview?.proxy]) {
      const options = Object.values(config ?? {});
      expect(options).toHaveLength(2);
      for (const option of options) {
        expect(option).toEqual({ target: "http://127.0.0.1:3000", changeOrigin: false });
      }
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
