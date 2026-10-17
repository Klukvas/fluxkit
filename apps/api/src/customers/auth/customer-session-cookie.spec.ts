import { Controller, Get, Module, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../../auth/session-cookie.js";
import {
  clearCustomerSessionCookie,
  CUSTOMER_SESSION_COOKIE_NAME,
  readCustomerSessionCookie,
  setCustomerSessionCookie,
} from "./customer-session-cookie.js";

const TOKEN = "A".repeat(43);
const OTHER_TOKEN = "B-_".repeat(15).slice(0, 43);

describe("readCustomerSessionCookie", () => {
  it("has the documented cookie name, different from the admin one", () => {
    expect(CUSTOMER_SESSION_COOKIE_NAME).toBe("fluxkit_customer_session");
    expect(CUSTOMER_SESSION_COOKIE_NAME).not.toBe(SESSION_COOKIE_NAME);
  });

  it("reads the token among other cookies", () => {
    expect(readCustomerSessionCookie(`theme=dark; fluxkit_customer_session=${TOKEN}; x=1`)).toBe(
      TOKEN,
    );
    expect(readCustomerSessionCookie(`fluxkit_customer_session=${TOKEN}`)).toBe(TOKEN);
  });

  it("never reads the admin cookie, alone or next to a customer one", () => {
    expect(readCustomerSessionCookie(`fluxkit_admin_session=${TOKEN}`)).toBeUndefined();
    expect(
      readCustomerSessionCookie(
        `fluxkit_admin_session=${OTHER_TOKEN}; fluxkit_customer_session=${TOKEN}`,
      ),
    ).toBe(TOKEN);
  });

  it("uses only the first valid occurrence when the cookie is repeated", () => {
    expect(
      readCustomerSessionCookie(
        `fluxkit_customer_session=short; fluxkit_customer_session=${TOKEN}; fluxkit_customer_session=${OTHER_TOKEN}`,
      ),
    ).toBe(TOKEN);
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["empty value", "fluxkit_customer_session="],
    ["token too short", "fluxkit_customer_session=abc"],
    ["token too long", `fluxkit_customer_session=${TOKEN}A`],
    ["characters outside base64url", `fluxkit_customer_session=${"A".repeat(42)}+`],
    ["quoted value", `fluxkit_customer_session="${TOKEN}"`],
    ["percent-encoded value", `fluxkit_customer_session=${"%41".repeat(43)}`],
    ["name prefix lookalike", `xfluxkit_customer_session=${TOKEN}`],
    ["name suffix lookalike", `fluxkit_customer_session2=${TOKEN}`],
    ["case differs", `Fluxkit_Customer_Session=${TOKEN}`],
  ])("returns undefined for %s", (_name, header) => {
    expect(readCustomerSessionCookie(header)).toBeUndefined();
  });

  it("ignores a non-string header value and a huge header", () => {
    expect(readCustomerSessionCookie(["a=b"] as unknown as string)).toBeUndefined();
    const huge = `${"a=b; ".repeat(200_000)}fluxkit_customer_session=${TOKEN}`;
    expect(readCustomerSessionCookie(huge)).toBeUndefined();
  });
});

@Controller("customer-cookie-probe")
class CookieProbeController {
  @Get("set-secure")
  setSecure(@Res({ passthrough: true }) response: Response): void {
    setCustomerSessionCookie(response, TOKEN, { secure: true, maxAgeSeconds: 2_160 * 3600 });
  }

  @Get("set-insecure")
  setInsecure(@Res({ passthrough: true }) response: Response): void {
    setCustomerSessionCookie(response, TOKEN, { secure: false, maxAgeSeconds: 3600 });
  }

  @Get("clear-secure")
  clearSecure(@Res({ passthrough: true }) response: Response): void {
    clearCustomerSessionCookie(response, { secure: true });
  }

  @Get("clear-insecure")
  clearInsecure(@Res({ passthrough: true }) response: Response): void {
    clearCustomerSessionCookie(response, { secure: false });
  }
}

@Module({ controllers: [CookieProbeController] })
class CookieProbeModule {}

/** `name=value` first, then attributes as a lower-cased map (flags map to `true`). */
function parseSetCookie(header: string): {
  pair: string;
  attributes: Record<string, string | true>;
} {
  const [pair = "", ...rest] = header.split("; ");
  const attributes: Record<string, string | true> = {};
  for (const attribute of rest) {
    const [key = "", value] = attribute.split("=");
    attributes[key.toLowerCase()] = value ?? true;
  }
  return { pair, attributes };
}

describe("customer session cookie Set-Cookie flags (real Express response)", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(CookieProbeModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setCookieOf(path: string): Promise<string[]> {
    const response = await fetch(`${baseUrl}/customer-cookie-probe/${path}`);
    return response.headers.getSetCookie();
  }

  it("sets exactly HttpOnly, SameSite=Lax, Path=/store, Secure, Max-Age and Expires", async () => {
    const headers = await setCookieOf("set-secure");
    expect(headers).toHaveLength(1);
    const { pair, attributes } = parseSetCookie(headers[0] ?? "");
    expect(pair).toBe(`fluxkit_customer_session=${TOKEN}`);
    expect(Object.keys(attributes).sort()).toEqual(
      ["expires", "httponly", "max-age", "path", "samesite", "secure"].sort(),
    );
    expect(attributes).toMatchObject({
      "max-age": String(2_160 * 3600),
      path: "/store",
      samesite: "Lax",
      httponly: true,
      secure: true,
    });
  });

  it("omits Secure when configured off, and keeps every other flag", async () => {
    const headers = await setCookieOf("set-insecure");
    const { attributes } = parseSetCookie(headers[0] ?? "");
    expect(Object.keys(attributes).sort()).toEqual(
      ["expires", "httponly", "max-age", "path", "samesite"].sort(),
    );
    expect(attributes).toMatchObject({
      "max-age": "3600",
      path: "/store",
      samesite: "Lax",
      httponly: true,
    });
  });

  it.each([
    ["clear-secure", true],
    ["clear-insecure", false],
  ])("%s expires the cookie on the same Path with the same flags", async (path, secure) => {
    const headers = await setCookieOf(path);
    expect(headers).toHaveLength(1);
    const { pair, attributes } = parseSetCookie(headers[0] ?? "");
    expect(pair).toBe("fluxkit_customer_session=");
    expect(attributes).toMatchObject({
      path: "/store",
      samesite: "Lax",
      httponly: true,
      expires: "Thu, 01 Jan 1970 00:00:00 GMT",
    });
    expect("secure" in attributes).toBe(secure);
  });
});
