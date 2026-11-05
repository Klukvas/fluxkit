import { describe, expect, it } from "vitest";
import { themeFormResponse } from "./theme-route";

const PUBLIC_ORIGIN = "https://shop.example";

function post(
  body: string,
  type = "application/x-www-form-urlencoded",
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/theme", {
    method: "POST",
    headers: { "content-type": type, ...headers },
    body,
  });
}

const enabled = {
  enabled: true,
  secure: async () => false,
  publicOrigin: async () => PUBLIC_ORIGIN,
};

describe("POST /theme (the switch without a script)", () => {
  it("stores the choice and sends the shopper back to the page with 303", async () => {
    const response = await themeFormResponse(post("mode=dark&return=%2Fen%2Fcatalog"), enabled);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/en/catalog");
    expect(response.headers.get("set-cookie")).toBe(
      "fluxkit_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("marks the cookie Secure when the shop is served over https", async () => {
    const response = await themeFormResponse(post("mode=system&return=%2Fuk"), {
      ...enabled,
      secure: async () => true,
    });
    expect(response.headers.get("set-cookie")).toContain("; Secure");
  });

  it("never redirects off the storefront", async () => {
    const response = await themeFormResponse(
      post("mode=light&return=%2F%2Fevil.example%2Fuk"),
      enabled,
    );
    expect(response.headers.get("location")).toBe("/uk");
  });

  it("refuses an unknown mode, a missing mode and a body that is not a form, setting nothing", async () => {
    for (const request of [
      post("mode=purple&return=%2Fuk"),
      post("return=%2Fuk"),
      post('{"mode":"dark"}', "application/json"),
    ]) {
      const response = await themeFormResponse(request, enabled);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
      // Status only: no hardcoded (untranslated) text reaches the shopper.
      expect(await response.text()).toBe("");
    }
  });

  it("answers 400, not 500, for a multipart body that cannot be parsed", async () => {
    const response = await themeFormResponse(
      post("not a multipart body", "multipart/form-data; boundary=missing"),
      enabled,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("does not exist while the switch is hidden in the config", async () => {
    const response = await themeFormResponse(post("mode=dark&return=%2Fuk"), {
      ...enabled,
      enabled: false,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a form posted from another site or another origin with 403, setting nothing", async () => {
    for (const headers of <Record<string, string>[]>[
      { "sec-fetch-site": "cross-site" },
      // A sibling host (`evil.shop.example`) is the same site but another origin.
      { "sec-fetch-site": "same-site" },
      { origin: "https://evil.example" },
      { origin: "http://shop.example" },
      { origin: "https://shop.example:8443" },
      { origin: "null" },
      { "sec-fetch-site": "same-origin", origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site", origin: PUBLIC_ORIGIN },
    ]) {
      const response = await themeFormResponse(
        post("mode=dark&return=%2Fuk", undefined, headers),
        enabled,
      );
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).toBe("");
    }
  });

  it("accepts the storefront's own form, a direct request and a client that sends neither header", async () => {
    for (const headers of <Record<string, string>[]>[
      { "sec-fetch-site": "same-origin", origin: PUBLIC_ORIGIN },
      { origin: PUBLIC_ORIGIN },
      { "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "none" },
      {},
    ]) {
      const response = await themeFormResponse(
        post("mode=dark&return=%2Fuk", undefined, headers),
        enabled,
      );
      expect(response.status, JSON.stringify(headers)).toBe(303);
      expect(response.headers.get("set-cookie")).toContain("fluxkit_theme=dark");
    }
  });
});
