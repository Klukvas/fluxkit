import { applyDecorators, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminController as KitAdminController } from "@fluxkit/api-kit";
import { ApiProblemResponses } from "../common/openapi.js";
import { AdminGuard } from "./admin.guard.js";
import { CATALOG_DEFAULT_PERMISSIONS, type DefaultPermissions } from "./route-access.js";

/**
 * Use instead of `@Controller` for every admin resource: `@AdminController("brands")` serves `/admin/brands`.
 * Bundles the route prefix, the default-deny guard, the Swagger tag and the problem responses every admin route
 * can produce (401, 403, 500). Routes add their own with `ApiProblemResponses(400, 404, 409)`.
 *
 * Permissions: a route without its own `@RequirePermission` requires `defaults.read` (GET, HEAD) or `defaults.write`
 * (every other method). Without `defaults` that is the catalog pair, `catalog.read` and `catalog.write`; a controller
 * of another area names its own pair, for example
 * `@AdminController("customers", { read: "customers.read", write: "customers.write" })`. Routes that need more
 * (publishing) or something else declare it explicitly.
 *
 * The prefix and the default-permission metadata come from the API kit's `AdminController` (ADR 0049), the one feature
 * packages use; this one adds what needs the API itself (the guard class and the OpenAPI decorators).
 */
export function AdminController(
  resource: string,
  defaults: DefaultPermissions = CATALOG_DEFAULT_PERMISSIONS,
): ClassDecorator {
  return applyDecorators(
    KitAdminController(resource, defaults),
    UseGuards(AdminGuard),
    ApiTags(`admin-${resource}`),
    ApiProblemResponses(401, 403, 500),
  );
}
