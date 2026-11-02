import { describe, expect, it } from "vitest";
import { themeFormResponse } from "./theme-route";

function post(body: string, type = "application/x-www-form-urlencoded"): Request {
  return new Request("http://localhost/theme", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });
}

const enabled = { enabled: true, secure: async () => false };

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
      enabled: true,
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
    }
  });

  it("does not exist while the switch is hidden in the config", async () => {
    const response = await themeFormResponse(post("mode=dark&return=%2Fuk"), {
      enabled: false,
      secure: async () => false,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
