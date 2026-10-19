import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_OPERATIONS, type AdminOperationName } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { canAccess, canRun, permissionOf } from "./permissions";
import { ROUTES } from "./routes";

interface OpenApiOperation {
  "x-fluxkit-permission"?: string;
}
const openapi = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../docs/api/openapi.json"), "utf8"),
) as { paths: Record<string, Record<string, OpenApiOperation>> };

/** The API's own statement of the permission an operation needs, read from the document, not from the client. */
function documentedPermission(operation: AdminOperationName): string | undefined {
  const spec = ADMIN_OPERATIONS[operation];
  return openapi.paths[spec.path]?.[spec.method.toLowerCase()]?.["x-fluxkit-permission"];
}

const operationNames = Object.keys(ADMIN_OPERATIONS) as AdminOperationName[];

describe("permission table against the API (x-fluxkit-permission in docs/api/openapi.json)", () => {
  it("covers every admin operation of the document", () => {
    expect(operationNames.length).toBeGreaterThan(80);
    for (const operation of operationNames) {
      expect(documentedPermission(operation), operation).toBeDefined();
    }
  });

  it("gives each operation the permission the API documents", () => {
    for (const operation of operationNames) {
      expect(permissionOf(operation), operation).toBe(documentedPermission(operation));
    }
  });

  it("guards each route with the documented permission of the operation the screen needs", () => {
    for (const route of ROUTES) {
      expect(route.permission, route.id).toBe(documentedPermission(route.operation));
    }
  });
});

describe("canAccess", () => {
  it("reads only the permission list of GET /admin/auth/me", () => {
    expect(canAccess(["catalog.read"], "catalog.read")).toBe(true);
    expect(canAccess(["catalog.read"], "catalog.write")).toBe(false);
    expect(canAccess([], "catalog.read")).toBe(false);
  });

  it("lets anyone signed in reach authenticated routes, everybody public ones and nobody denied ones", () => {
    expect(canAccess([], "authenticated")).toBe(true);
    expect(canAccess(null, "authenticated")).toBe(false);
    expect(canAccess(null, "public")).toBe(true);
    expect(canAccess(null, "catalog.read")).toBe(false);
    expect(canAccess([...ROLE_PERMISSIONS.owner], "denied")).toBe(false);
  });

  it("matches the role table of core for the three roles", () => {
    const viewer = [...ROLE_PERMISSIONS.viewer];
    const manager = [...ROLE_PERMISSIONS.manager];
    const owner = [...ROLE_PERMISSIONS.owner];
    expect(canRun(viewer, "listProducts")).toBe(true);
    expect(canRun(viewer, "updateProduct")).toBe(false);
    expect(canRun(viewer, "listOrders")).toBe(false);
    expect(canRun(manager, "markOrderPaid")).toBe(true);
    expect(canRun(manager, "publishProduct")).toBe(true);
    expect(canRun(manager, "listUsers")).toBe(false);
    expect(canRun(owner, "listUsers")).toBe(true);
    expect(canRun([], "getMe")).toBe(true);
    expect(canRun(null, "login")).toBe(true);
  });
});
