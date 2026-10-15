import { applyDecorators, Controller, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiProblemResponses } from "../common/openapi.js";
import { AdminGuard } from "./admin.guard.js";

/**
 * Use instead of `@Controller` for every admin resource: `@AdminController("brands")` serves `/admin/brands`.
 * Bundles the route prefix, the default-deny guard, the Swagger tag and the problem responses every admin route
 * can produce (401, 500). Routes add their own with `ApiProblemResponses(400, 404, 409)`.
 */
export function AdminController(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`admin/${resource}`),
    UseGuards(AdminGuard),
    ApiTags(`admin-${resource}`),
    ApiProblemResponses(401, 500),
  );
}
