import { describe, expect, it } from "vitest";
import { allowedImageUrl, parseImageHosts } from "./image-source";

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
