import { Controller, Get, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ProblemException } from "../../common/problem.js";
import type { CustomerAuthenticator, CustomerPrincipal } from "./customer-authenticator.js";
import { getCurrentCustomer } from "./current-customer.js";
import { CustomerGuard } from "./customer.guard.js";

const PRINCIPAL: CustomerPrincipal = {
  customerId: "11111111-1111-4111-8111-111111111111",
  email: "shopper@example.test",
  sessionId: "22222222-2222-4222-8222-222222222222",
};

@Controller("store/account")
class ProbeController {
  @Get("me")
  me(): string {
    return "ok";
  }
}

function contextFor(request: object, headers: Record<string, string>): ExecutionContext {
  const response = { setHeader: (name: string, value: string) => (headers[name] = value) };
  return {
    getHandler: () => ProbeController.prototype.me,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

function guardWith(result: () => unknown): CustomerGuard {
  const authenticator: CustomerAuthenticator = {
    authenticate: async () => result() as CustomerPrincipal | undefined,
  };
  return new CustomerGuard(authenticator);
}

async function failureOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

describe("CustomerGuard", () => {
  it("lets a principal through, exposes it to @CurrentCustomer and sets Cache-Control: no-store", async () => {
    const request = {};
    const headers: Record<string, string> = {};
    const allowed = await guardWith(() => PRINCIPAL).canActivate(contextFor(request, headers));
    expect(allowed).toBe(true);
    expect(getCurrentCustomer(request)).toEqual(PRINCIPAL);
    expect(headers["Cache-Control"]).toBe("no-store");
  });

  it.each([undefined, null])(
    "answers 401 unauthorized for %s and still marks the response no-store",
    async (nobody) => {
      const headers: Record<string, string> = {};
      const request = {};
      const error = await failureOf(() =>
        guardWith(() => nobody).canActivate(contextFor(request, headers)),
      );
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).code).toBe("unauthorized");
      expect((error as ProblemException).getStatus()).toBe(401);
      expect(headers["Cache-Control"]).toBe("no-store");
      expect(getCurrentCustomer(request)).toBeUndefined();
    },
  );

  it.each([
    ["a string", "customer"],
    ["an empty object", {}],
    ["a principal without a session id", { customerId: "x", email: "a@b.test" }],
    ["a principal with a numeric id", { ...PRINCIPAL, customerId: 7 }],
    ["an admin principal", { userId: "x", email: "a@b.test", role: "owner", permissions: [] }],
  ])(
    "a broken authenticator returning %s ends as a server error, never as access",
    async (_n, value) => {
      const request = {};
      const error = await failureOf(() =>
        guardWith(() => value).canActivate(contextFor(request, {})),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(getCurrentCustomer(request)).toBeUndefined();
    },
  );

  it("an authenticator that throws is not turned into access or into a 401", async () => {
    const boom = new Error("database down");
    const error = await failureOf(() =>
      guardWith(() => {
        throw boom;
      }).canActivate(contextFor({}, {})),
    );
    expect(error).toBe(boom);
  });

  it("checks a request only once even when the guard is declared twice", async () => {
    let calls = 0;
    const guard = guardWith(() => {
      calls += 1;
      return PRINCIPAL;
    });
    const request = {};
    await guard.canActivate(contextFor(request, {}));
    await guard.canActivate(contextFor(request, {}));
    expect(calls).toBe(1);
  });
});
