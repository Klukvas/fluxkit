import { Controller, Get, Module, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "./session-cookie.js";

const TOKEN = "A".repeat(43);
const OTHER_TOKEN = "B-_".repeat(15).slice(0, 43);

describe("readSessionCookie", () => {
  it("has the documented cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("fluxkit_admin_session");
  });

  it("reads the token among other cookies", () => {
    expect(readSessionCookie(`theme=dark; fluxkit_admin_session=${TOKEN}; x=1`)).toBe(TOKEN);
    expect(readSessionCookie(`fluxkit_admin_session=${TOKEN}`)).toBe(TOKEN);
    expect(readSessionCookie(`  fluxkit_admin_session=${TOKEN}  ;a=b`)).toBe(TOKEN);
  });

  it("uses only the first valid occurrence when the cookie is repeated", () => {
    expect(
      readSessionCookie(`fluxkit_admin_session=${TOKEN}; fluxkit_admin_session=${OTHER_TOKEN}`),
    ).toBe(TOKEN);
  });

  it("skips a malformed occurrence and uses the first valid one", () => {
    expect(readSessionCookie(`fluxkit_admin_session=short; fluxkit_admin_session=${TOKEN}`)).toBe(
      TOKEN,
    );
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["only separators", ";;; ;"],
    ["no equals sign", "fluxkit_admin_session"],
    ["empty value", "fluxkit_admin_session="],
    ["token too short", "fluxkit_admin_session=abc"],
    ["token too long", `fluxkit_admin_session=${TOKEN}A`],
    ["characters outside base64url", `fluxkit_admin_session=${"A".repeat(42)}+`],
    ["quoted value", `fluxkit_admin_session="${TOKEN}"`],
    ["percent-encoded value", `fluxkit_admin_session=${"%41".repeat(43)}`],
    ["other name only", `other=${TOKEN}`],
    ["name prefix lookalike", `xfluxkit_admin_session=${TOKEN}`],
    ["name suffix lookalike", `fluxkit_admin_session2=${TOKEN}`],
    ["case differs", `Fluxkit_Admin_Session=${TOKEN}`],
    ["NUL byte", `fluxkit_admin_session=${"A".repeat(42)}\u0000`],
  ])("returns undefined for %s", (_name, header) => {
    expect(readSessionCookie(header)).toBeUndefined();
  });

  it("does not crash on a huge header and does not use it", () => {
    const huge = `${"a=b; ".repeat(200_000)}fluxkit_admin_session=${TOKEN}`;
    expect(readSessionCookie(huge)).toBeUndefined();
    expect(readSessionCookie("=".repeat(1_000_000))).toBeUndefined();
    expect(readSessionCookie(`${"x".repeat(1_000_000)}=1`)).toBeUndefined();
  });

  it("ignores a non-string header value", () => {
    expect(readSessionCookie(["a=b"] as unknown as string)).toBeUndefined();
    expect(readSessionCookie(42 as unknown as string)).toBeUndefined();
  });
});

@Controller("cookie-probe")
class CookieProbeController {
  @Get("set-secure")
  setSecure(@Res({ passthrough: true }) response: Response): void {
    setSessionCookie(response, TOKEN, { secure: true, maxAgeSeconds: 168 * 3600 });
  }

  @Get("set-insecure")
  setInsecure(@Res({ passthrough: true }) response: Response): void {
    setSessionCookie(response, TOKEN, { secure: false, maxAgeSeconds: 3600 });
  }

  @Get("clear-secure")
  clearSecure(@Res({ passthrough: true }) response: Response): void {
    clearSessionCookie(response, { secure: true });
  }

  @Get("clear-insecure")
  clearInsecure(@Res({ passthrough: true }) response: Response): void {
    clearSessionCookie(response, { secure: false });
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

describe("session cookie Set-Cookie flags (real Express response)", () => {
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
    const response = await fetch(`${baseUrl}/cookie-probe/${path}`);
    return response.headers.getSetCookie();
  }

  it("sets HttpOnly, SameSite=Strict, Path=/admin, Secure and Max-Age", async () => {
    const headers = await setCookieOf("set-secure");
    expect(headers).toHaveLength(1);
    const { pair, attributes } = parseSetCookie(headers[0] ?? "");
    expect(pair).toBe(`fluxkit_admin_session=${TOKEN}`);
    expect(Object.keys(attributes).sort()).toEqual(
      ["expires", "httponly", "max-age", "path", "samesite", "secure"].sort(),
    );
    expect(attributes).toMatchObject({
      "max-age": String(168 * 3600),
      path: "/admin",
      samesite: "Strict",
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
      path: "/admin",
      samesite: "Strict",
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
    expect(pair).toBe("fluxkit_admin_session=");
    expect(attributes).toMatchObject({
      path: "/admin",
      samesite: "Strict",
      httponly: true,
      expires: "Thu, 01 Jan 1970 00:00:00 GMT",
    });
    expect("secure" in attributes).toBe(secure);
  });
});
