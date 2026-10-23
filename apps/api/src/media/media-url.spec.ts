import { describe, expect, it } from "vitest";
import { classifyMediaUrl } from "./media-url.js";

const BASE = "https://shop.example.com/media";
const KEY = "0123456789abcdef0123456789abcdef.webp";

describe("classifyMediaUrl (attach marking, ADR 0028 decision 5)", () => {
  it("finds the key of a URL under the public base URL", () => {
    expect(classifyMediaUrl(`${BASE}/${KEY}`, BASE)).toEqual({ kind: "upload", key: KEY });
    for (const extension of ["jpg", "png", "webp"]) {
      const key = `ffffffffffffffffffffffffffffffff.${extension}`;
      expect(classifyMediaUrl(`${BASE}/${key}`, BASE)).toEqual({ kind: "upload", key });
    }
  });

  it("treats the same origin written differently as ours: host case, scheme case, default port, dot segments", () => {
    for (const url of [
      `HTTPS://SHOP.EXAMPLE.COM/media/${KEY}`,
      `https://shop.example.com:443/media/${KEY}`,
      `https://shop.example.com/media/./${KEY}`,
      `https://shop.example.com/x/../media/${KEY}`,
      `https://shop.example.com/MEDIA/${KEY}`,
    ]) {
      expect(classifyMediaUrl(url, BASE), url).toEqual({ kind: "upload", key: KEY });
    }
  });

  it("leaves URLs of other origins and other paths alone (URL-based media keeps working)", () => {
    for (const url of [
      `https://cdn.example.com/media/${KEY}`,
      `http://shop.example.com/media/${KEY}`,
      `https://shop.example.com:8443/media/${KEY}`,
      `https://shop.example.com.evil.test/media/${KEY}`,
      `https://shop.example.com/mediax/${KEY}`,
      `https://shop.example.com/media`,
      `https://shop.example.com/other/${KEY}`,
      `https://shop.example.com/media/../admin/${KEY}`,
      "https://images.example.org/products/1.jpg",
      "not a url",
    ]) {
      expect(classifyMediaUrl(url, BASE), url).toEqual({ kind: "foreign" });
    }
  });

  it("calls a URL under our prefix that cannot name an upload invalid (it must be refused, not ignored)", () => {
    for (const url of [
      `${BASE}/`,
      `${BASE}/missing.png`,
      `${BASE}/${KEY.toUpperCase()}`,
      `${BASE}/${KEY}?size=2`,
      `${BASE}/${KEY}#x`,
      `${BASE}/${KEY}/`,
      `${BASE}/ab/cd/${KEY}`,
      `${BASE}/%30123456789abcdef0123456789abcdef.webp`,
      `${BASE}/${KEY}%00`,
      `${BASE}/..%2f${KEY}`,
      `https://user:secret@shop.example.com/media/${KEY}`,
      `${BASE}/0123456789abcdef0123456789abcdef.jpeg`,
    ]) {
      expect(classifyMediaUrl(url, BASE), url).toEqual({ kind: "invalid" });
    }
  });

  it("handles a base URL at the root of its own host (a cookie-less media host or CDN)", () => {
    const base = "https://media.example.com";
    expect(classifyMediaUrl(`${base}/${KEY}`, base)).toEqual({ kind: "upload", key: KEY });
    expect(classifyMediaUrl(`${base}/products/1.jpg`, base)).toEqual({ kind: "invalid" });
    expect(classifyMediaUrl(`https://shop.example.com/${KEY}`, base)).toEqual({
      kind: "foreign",
    });
  });

  it("handles the development default on a port over http", () => {
    const base = "http://127.0.0.1:3000/media";
    expect(classifyMediaUrl(`http://127.0.0.1:3000/media/${KEY}`, base)).toEqual({
      kind: "upload",
      key: KEY,
    });
    expect(classifyMediaUrl(`http://127.0.0.1:3001/media/${KEY}`, base)).toEqual({
      kind: "foreign",
    });
    expect(classifyMediaUrl(`http://localhost:3000/media/${KEY}`, base)).toEqual({
      kind: "foreign",
    });
  });

  it("refuses a base URL that is not absolute instead of matching everything", () => {
    expect(() => classifyMediaUrl(`${BASE}/${KEY}`, "/media")).toThrow(TypeError);
  });
});
