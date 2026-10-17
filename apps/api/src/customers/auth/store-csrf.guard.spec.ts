import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { isStorePath } from "../../common/store-path.js";
import { StoreCsrfGuard } from "./store-csrf.guard.js";

function contextFor(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  type = "http",
): ExecutionContext {
  const request = {
    method,
    path,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const guard = new StoreCsrfGuard();

describe("isStorePath", () => {
  it.each(["/store", "/store/", "/store/cart", "/STORE/cart", "/Store/account/me"])(
    "%s is a store path",
    (path) => {
      expect(isStorePath(path)).toBe(true);
    },
  );

  it.each(["/", "/admin/store", "/storefront", "/stores", "/health", "/x/store", ""])(
    "%s is not",
    (path) => {
      expect(isStorePath(path)).toBe(false);
    },
  );
});

describe("StoreCsrfGuard", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s under /store without the header is 403 forbidden",
    (method) => {
      expect(() => guard.canActivate(contextFor(method, "/store/cart"))).toThrowError(
        expect.objectContaining({ code: "forbidden" }) as Error,
      );
    },
  );

  it.each(["/STORE/cart", "/store", "/store/", "/Store/account/login"])(
    "also guards the spelling %s that Express routes to the same handler",
    (path) => {
      expect(() => guard.canActivate(contextFor("POST", path))).toThrowError(
        expect.objectContaining({ code: "forbidden" }) as Error,
      );
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])("%s is exempt", (method) => {
    expect(guard.canActivate(contextFor(method, "/store/cart"))).toBe(true);
  });

  it("lets a state-changing request with the header through", () => {
    expect(guard.canActivate(contextFor("POST", "/store/cart", { "x-fluxkit-csrf": "1" }))).toBe(
      true,
    );
  });

  it("requires a JSON content type when there is a body", () => {
    const headers = { "x-fluxkit-csrf": "1", "content-length": "5", "content-type": "text/plain" };
    expect(() => guard.canActivate(contextFor("POST", "/store/cart", headers))).toThrowError(
      expect.objectContaining({ code: "forbidden" }) as Error,
    );
  });

  it("does not touch other paths (the admin guard owns /admin)", () => {
    expect(guard.canActivate(contextFor("POST", "/admin/brands"))).toBe(true);
    expect(guard.canActivate(contextFor("POST", "/health"))).toBe(true);
  });

  it("ignores non-HTTP contexts", () => {
    expect(guard.canActivate(contextFor("POST", "/store/cart", {}, "rpc"))).toBe(true);
  });
});
