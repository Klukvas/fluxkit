import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedImageUrl, developmentMediaBaseUrl, parseImageHosts } from "./image-source";

describe("parseImageHosts", () => {
  it("splits, trims and lower-cases the build-time list; nothing means no host", () => {
    expect(parseImageHosts(undefined)).toEqual([]);
    expect(parseImageHosts("")).toEqual([]);
    expect(parseImageHosts(" CDN.example.com , images.example.org ")).toEqual([
      "cdn.example.com",
      "images.example.org",
    ]);
  });
});

describe("allowedImageUrl", () => {
  const hosts = ["cdn.example.com"];

  it("accepts an https URL on an allowed host and returns it normalized", () => {
    expect(allowedImageUrl("https://cdn.example.com/a/b.jpg?v=2", hosts)).toBe(
      "https://cdn.example.com/a/b.jpg?v=2",
    );
    expect(allowedImageUrl("https://CDN.EXAMPLE.COM/a.jpg", hosts)).toBe(
      "https://cdn.example.com/a.jpg",
    );
  });

  it("rejects any other host: the host check is the allow-list", () => {
    expect(allowedImageUrl("https://example.com/placeholder/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("https://evil.example/a.jpg", hosts)).toBeNull();
  });

  it("rejects look-alike hosts (suffix, prefix, subdomain, userinfo trick)", () => {
    expect(allowedImageUrl("https://cdn.example.com.evil.example/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("https://evilcdn.example.com/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("https://x.cdn.example.com/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("https://cdn.example.com@evil.example/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("https://user:pw@cdn.example.com/a.jpg", hosts)).toBeNull();
  });

  it("rejects other schemes, ports, relative and malformed URLs", () => {
    expect(allowedImageUrl("http://cdn.example.com/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("data:image/png;base64,AAAA", hosts)).toBeNull();
    expect(allowedImageUrl("javascript:alert(1)", hosts)).toBeNull();
    expect(allowedImageUrl("//cdn.example.com/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("/uploads/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("https://cdn.example.com:8443/a.jpg", hosts)).toBeNull();
    expect(allowedImageUrl("not a url", hosts)).toBeNull();
    expect(allowedImageUrl("", hosts)).toBeNull();
  });

  it("rejects everything when no host is allowed, and a missing URL", () => {
    expect(allowedImageUrl("https://cdn.example.com/a.jpg", [])).toBeNull();
    expect(allowedImageUrl(null, hosts)).toBeNull();
    expect(allowedImageUrl(undefined, hosts)).toBeNull();
  });
});

// Owner decision 2026-11-01 (plan docs/plans/2026-11-01-demo-images-local-run.md, option a): in `next dev` ONLY, an uploaded
// image of the local API (`<MEDIA_PUBLIC_BASE_URL>/<key>`) renders as the same-origin path `/media/<key>`, which the dev
// server rewrites to the API. Everywhere else the https + allow-list rule above is the only rule.
describe("allowedImageUrl development media rule", () => {
  const base = "http://127.0.0.1:3000/media";
  const key = "0123456789abcdef0123456789abcdef.webp";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps an upload of the configured prefix to the same-origin /media path", () => {
    expect(allowedImageUrl(`${base}/${key}`, [], base)).toBe(`/media/${key}`);
    expect(allowedImageUrl(`${base}/${key.replace(".webp", ".jpg")}`, [], base)).toBe(
      `/media/${key.replace(".webp", ".jpg")}`,
    );
  });

  it("maps nothing that is not exactly <prefix>/<media key>", () => {
    for (const value of [
      `http://127.0.0.1:3001/media/${key}`,
      `http://localhost:3000/media/${key}`,
      `${base}/${key.toUpperCase()}`,
      `${base}/../${key}`,
      `${base}/a/${key}`,
      `${base}/${key}?x=1`,
      `${base}/0123.webp`,
      `${base}/${key.replace(".webp", ".gif")}`,
      `${base}x/${key}`,
    ]) {
      expect(allowedImageUrl(value, [], base), value).toBeNull();
    }
  });

  it("keeps the https allow-list working next to it", () => {
    expect(allowedImageUrl("https://cdn.example.com/a.jpg", ["cdn.example.com"], base)).toBe(
      "https://cdn.example.com/a.jpg",
    );
  });

  it("is off unless NODE_ENV is development, whatever the dev server variable says", () => {
    vi.stubEnv("FLUXKIT_DEV_MEDIA_BASE_URL", base);
    for (const nodeEnv of ["production", "test", ""]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      expect(developmentMediaBaseUrl(), nodeEnv).toBeUndefined();
      expect(allowedImageUrl(`${base}/${key}`, []), nodeEnv).toBeNull();
    }
    vi.stubEnv("NODE_ENV", "development");
    expect(developmentMediaBaseUrl()).toBe(base);
    expect(allowedImageUrl(`${base}/${key}`, [])).toBe(`/media/${key}`);
  });

  it("is off in development when the dev server set no prefix", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLUXKIT_DEV_MEDIA_BASE_URL", "");
    expect(developmentMediaBaseUrl()).toBeUndefined();
    expect(allowedImageUrl(`${base}/${key}`, [])).toBeNull();
  });
});
