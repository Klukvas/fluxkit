import { applyDecorators, Controller } from "@nestjs/common";
import {
  CATALOG_DEFAULT_PERMISSIONS,
  UseDefaultPermissionByMethod,
  type DefaultPermissions,
} from "./route-access.js";

/**
 * Use instead of `@Controller` for every admin resource: `@AdminController("brands")` serves `/admin/brands`.
 *
 * Permissions: a route without its own `@RequirePermission` requires `defaults.read` (GET, HEAD) or `defaults.write`
 * (every other method). Without `defaults` that is the catalog pair, `catalog.read` and `catalog.write`; a controller
 * of another area names its own pair, for example
 * `@AdminController("customers", { read: "customers.read", write: "customers.write" })`.
 *
 * This is the part a feature package can use: the route prefix and the default-permission metadata. The API's global
 * guard (`AdminPathGuard`) checks every route under `/admin`, so a feature's routes are authenticated and authorized like
 * core ones (default deny). The API's own `AdminController` adds the Swagger tag and the documented problem responses
 * on top of this one (ADR 0049).
 */
export function AdminController(
  resource: string,
  defaults: DefaultPermissions = CATALOG_DEFAULT_PERMISSIONS,
): ClassDecorator {
  return applyDecorators(Controller(`admin/${resource}`), UseDefaultPermissionByMethod(defaults));
}
