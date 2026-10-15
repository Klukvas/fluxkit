import { applyDecorators, Controller, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiProblemResponses } from "../common/openapi.js";
import { AdminGuard } from "./admin.guard.js";
import { UseDefaultPermissionByMethod } from "./route-access.js";

/**
 * Use instead of `@Controller` for every admin resource: `@AdminController("brands")` serves `/admin/brands`.
 * Bundles the route prefix, the default-deny guard, the Swagger tag and the problem responses every admin route
 * can produce (401, 403, 500). Routes add their own with `ApiProblemResponses(400, 404, 409)`.
 *
 * Permissions: a route without its own `@RequirePermission` requires `catalog.read` (GET, HEAD) or `catalog.write`
 * (every other method). Routes that need more (publishing) or something else declare it explicitly.
 */
export function AdminController(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`admin/${resource}`),
    UseGuards(AdminGuard),
    UseDefaultPermissionByMethod(),
    ApiTags(`admin-${resource}`),
    ApiProblemResponses(401, 403, 500),
  );
}
