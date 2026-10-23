import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { permissionsOf, type AdminRole } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { ProblemException } from "../common/problem.js";
import type { AdminAuthenticator, AdminPrincipal } from "./admin-authenticator.js";
import { AdminGuard } from "./admin.guard.js";
import {
  AuthenticatedAdminRoute,
  UseDefaultPermissionByMethod,
  PublicAdminRoute,
  RequirePermission,
  resolveRouteAccess,
} from "./route-access.js";
import { getCurrentAdmin } from "./current-admin.js";
import { AcceptsBinaryUpload } from "./csrf.js";

function principal(role: AdminRole): AdminPrincipal {
  return {
    userId: "u1",
    email: "u1@example.test",
    role,
    permissions: permissionsOf(role),
    sessionId: "s1",
  };
}

@UseDefaultPermissionByMethod()
class DefaultsController {
  list(): void {}
  create(): void {}
  @RequirePermission("catalog.publish")
  publish(): void {}
  @PublicAdminRoute()
  login(): void {}
  @AuthenticatedAdminRoute()
  logout(): void {}
}

@UseDefaultPermissionByMethod()
class UploadController {
  @AcceptsBinaryUpload()
  upload(): void {}
  create(): void {}
}

class PlainController {
  list(): void {}
}

@RequirePermission("users.manage")
@UseDefaultPermissionByMethod()
class UsersController {
  list(): void {}
  @RequirePermission("catalog.read")
  mine(): void {}
}

class BrokenController {
  @PublicAdminRoute()
  @RequirePermission("catalog.read")
  both(): void {}

  @AuthenticatedAdminRoute()
  @RequirePermission("users.manage")
  signedInAndPermissioned(): void {}

  @AuthenticatedAdminRoute()
  @PublicAdminRoute()
  signedInAndPublic(): void {}
}

/** A route-level marker wins over the controller's permission, like @RequirePermission does. */
@RequirePermission("users.manage")
class UsersWithSelfServiceController {
  list(): void {}
  @AuthenticatedAdminRoute()
  mine(): void {}
}

function contextFor(
  controller: new () => object,
  handlerName: string,
  method: string,
  headers: Record<string, string> = { "x-fluxkit-csrf": "1" },
): { context: ExecutionContext; request: object } {
  const request = {
    method,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  };
  const handler = (controller.prototype as Record<string, () => void>)[handlerName] as () => void;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
  return { context, request };
}

const guardFor = (authenticate: AdminAuthenticator["authenticate"]): AdminGuard =>
  new AdminGuard({ authenticate }, new Reflector());

describe("AdminGuard", () => {
  it("answers 401 when the authenticator knows nobody", async () => {
    const guard = guardFor(() => undefined);
    const { context } = contextFor(DefaultsController, "list", "GET");
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ProblemException);
  });

  it("lets a principal with the permission through, synchronously or asynchronously, and exposes it", async () => {
    for (const authenticate of [() => principal("viewer"), async () => principal("viewer")]) {
      const { context, request } = contextFor(DefaultsController, "list", "GET");
      expect(await guardFor(authenticate).canActivate(context)).toBe(true);
      expect(getCurrentAdmin(request)).toMatchObject({ role: "viewer", userId: "u1" });
    }
  });

  it("applies the default by method: GET needs catalog.read, others catalog.write", async () => {
    const viewer = guardFor(() => principal("viewer"));
    expect(await viewer.canActivate(contextFor(DefaultsController, "list", "GET").context)).toBe(
      true,
    );
    expect(await viewer.canActivate(contextFor(DefaultsController, "list", "HEAD").context)).toBe(
      true,
    );
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await expect(
        viewer.canActivate(contextFor(DefaultsController, "create", method).context),
        method,
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    const manager = guardFor(() => principal("manager"));
    expect(
      await manager.canActivate(contextFor(DefaultsController, "create", "POST").context),
    ).toBe(true);
  });

  it("a route-level @RequirePermission overrides the default", async () => {
    const { context } = contextFor(DefaultsController, "publish", "POST");
    await expect(guardFor(() => principal("viewer")).canActivate(context)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await guardFor(() => principal("manager")).canActivate(context)).toBe(true);
  });

  it("a controller-level permission applies to its routes, and a route can override it", async () => {
    const owner = guardFor(() => principal("owner"));
    const manager = guardFor(() => principal("manager"));
    expect(await owner.canActivate(contextFor(UsersController, "list", "GET").context)).toBe(true);
    await expect(
      manager.canActivate(contextFor(UsersController, "list", "GET").context),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await manager.canActivate(contextFor(UsersController, "mine", "GET").context)).toBe(
      true,
    );
  });

  it("denies a route without any permission metadata: 401 anonymous, 403 signed in, for every role", async () => {
    const { context } = contextFor(PlainController, "list", "GET");
    await expect(guardFor(() => undefined).canActivate(context)).rejects.toMatchObject({
      code: "unauthorized",
    });
    for (const role of ["owner", "manager", "viewer"] as const) {
      await expect(
        guardFor(() => principal(role)).canActivate(context),
        role,
      ).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("skips authentication and permissions on a @PublicAdminRoute, but not the CSRF check", async () => {
    let calls = 0;
    const guard = guardFor(() => {
      calls += 1;
      return undefined;
    });
    const open = contextFor(DefaultsController, "login", "POST");
    expect(await guard.canActivate(open.context)).toBe(true);
    expect(calls).toBe(0);
    expect(getCurrentAdmin(open.request)).toBeUndefined();
    await expect(
      guard.canActivate(contextFor(DefaultsController, "login", "POST", {}).context),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("checks CSRF before authentication, also for anonymous callers", async () => {
    let calls = 0;
    const guard = guardFor(() => {
      calls += 1;
      return undefined;
    });
    const { context } = contextFor(DefaultsController, "create", "POST", {});
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "forbidden" });
    expect(calls).toBe(0);
  });

  it("asks the authenticator once per request", async () => {
    let calls = 0;
    const guard = guardFor(() => {
      calls += 1;
      return principal("owner");
    });
    const { context } = contextFor(DefaultsController, "list", "GET");
    await guard.canActivate(context);
    await guard.canActivate(context);
    expect(calls).toBe(1);
  });

  it("refuses a route that is both public and permissioned instead of picking one", async () => {
    const { context } = contextFor(BrokenController, "both", "GET");
    await expect(guardFor(() => principal("owner")).canActivate(context)).rejects.toThrow(
      /both @PublicAdminRoute and @RequirePermission/,
    );
  });

  it.each([
    false,
    true,
    "yes",
    1,
    {},
    { ...principal("owner"), role: "root" },
    { ...principal("owner"), permissions: ["everything"] },
  ])("does not turn a broken authenticator answer (%j) into access", async (answer) => {
    const { context } = contextFor(DefaultsController, "list", "GET");
    const guard = guardFor(() => answer as unknown as AdminPrincipal);
    await expect(guard.canActivate(context)).rejects.toThrow(/not an AdminPrincipal/);
  });

  it("treats null like undefined (not signed in)", async () => {
    const { context } = contextFor(DefaultsController, "list", "GET");
    await expect(
      guardFor(() => null as unknown as undefined).canActivate(context),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("does not turn an authenticator failure into access", async () => {
    const failing = guardFor(() => Promise.reject(new Error("token store down")));
    const { context } = contextFor(DefaultsController, "list", "GET");
    await expect(failing.canActivate(context)).rejects.toThrow("token store down");
  });

  describe("@AuthenticatedAdminRoute (any signed-in admin, no particular permission)", () => {
    it("resolves to the authenticated kind, ahead of the controller default", () => {
      const access = resolveRouteAccess(
        new Reflector(),
        DefaultsController.prototype.logout,
        DefaultsController,
        "POST",
      );
      expect(access).toEqual({ kind: "authenticated" });
    });

    it("answers 401 to an anonymous caller", async () => {
      const { context } = contextFor(DefaultsController, "logout", "POST");
      await expect(guardFor(() => undefined).canActivate(context)).rejects.toMatchObject({
        code: "unauthorized",
      });
    });

    it.each(["owner", "manager", "viewer"] as const)(
      "lets a signed-in %s through a POST, which the write default would deny a viewer",
      async (role) => {
        const { context, request } = contextFor(DefaultsController, "logout", "POST");
        expect(await guardFor(() => principal(role)).canActivate(context)).toBe(true);
        expect(getCurrentAdmin(request)).toMatchObject({ role });
      },
    );

    it("still checks the CSRF header before authentication", async () => {
      let calls = 0;
      const guard = guardFor(() => {
        calls += 1;
        return principal("owner");
      });
      const { context } = contextFor(DefaultsController, "logout", "POST", {});
      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "forbidden" });
      expect(calls).toBe(0);
    });

    it("lets a route opt out of its controller's permission", async () => {
      const viewer = guardFor(() => principal("viewer"));
      await expect(
        viewer.canActivate(contextFor(UsersWithSelfServiceController, "list", "GET").context),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        await viewer.canActivate(contextFor(UsersWithSelfServiceController, "mine", "GET").context),
      ).toBe(true);
    });

    it("refuses to combine the marker with a permission or with public, instead of picking one", async () => {
      for (const handler of ["signedInAndPermissioned", "signedInAndPublic"]) {
        const { context } = contextFor(BrokenController, handler, "GET");
        await expect(
          guardFor(() => principal("owner")).canActivate(context),
          handler,
        ).rejects.toThrow(/cannot be both/);
      }
    });
  });

  describe("@AcceptsBinaryUpload (ADR 0028 decision 4)", () => {
    const binaryHeaders = {
      "x-fluxkit-csrf": "1",
      "content-length": "4",
      "content-type": "application/octet-stream",
    };

    it("lets an octet-stream body through on the marked route only", async () => {
      const guard = guardFor(() => principal("manager"));
      expect(
        await guard.canActivate(
          contextFor(UploadController, "upload", "POST", binaryHeaders).context,
        ),
      ).toBe(true);
      await expect(
        guard.canActivate(contextFor(UploadController, "create", "POST", binaryHeaders).context),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        guard.canActivate(contextFor(DefaultsController, "create", "POST", binaryHeaders).context),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("refuses JSON and a missing CSRF header on the marked route, before authentication", async () => {
      let calls = 0;
      const guard = guardFor(() => {
        calls += 1;
        return principal("owner");
      });
      for (const headers of [
        { ...binaryHeaders, "content-type": "application/json" },
        { ...binaryHeaders, "content-type": "multipart/form-data; boundary=x" },
        { "content-length": "4", "content-type": "application/octet-stream" },
      ]) {
        await expect(
          guard.canActivate(contextFor(UploadController, "upload", "POST", headers).context),
          JSON.stringify(headers),
        ).rejects.toMatchObject({ code: "forbidden" });
      }
      expect(calls).toBe(0);
    });

    it("still authenticates and checks the permission after the exception", async () => {
      await expect(
        guardFor(() => undefined).canActivate(
          contextFor(UploadController, "upload", "POST", binaryHeaders).context,
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });
      await expect(
        guardFor(() => principal("viewer")).canActivate(
          contextFor(UploadController, "upload", "POST", binaryHeaders).context,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    });
  });
});
