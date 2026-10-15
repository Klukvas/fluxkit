import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ProblemException } from "../common/problem.js";
import { DenyAllAdminAuthenticator, type AdminAuthenticator } from "./admin-authenticator.js";
import { AdminGuard } from "./admin.guard.js";

const context = {
  switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
} as unknown as ExecutionContext;

describe("AdminGuard", () => {
  it("denies by default: the default authenticator allows nothing", async () => {
    const guard = new AdminGuard(new DenyAllAdminAuthenticator());
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ProblemException);
  });

  it("lets a request through only when the authenticator says true", async () => {
    expect(await new AdminGuard({ allows: () => true }).canActivate(context)).toBe(true);
    expect(await new AdminGuard({ allows: async () => true }).canActivate(context)).toBe(true);
  });

  it.each([false, undefined, null, "yes", 1])(
    "denies when the authenticator answers %j",
    async (answer) => {
      const authenticator = { allows: () => answer } as unknown as AdminAuthenticator;
      await expect(new AdminGuard(authenticator).canActivate(context)).rejects.toMatchObject({
        code: "unauthorized",
      });
    },
  );

  it("does not turn an authenticator failure into access", async () => {
    const failing: AdminAuthenticator = {
      allows: () => Promise.reject(new Error("token store down")),
    };
    await expect(new AdminGuard(failing).canActivate(context)).rejects.toThrow("token store down");
  });
});
