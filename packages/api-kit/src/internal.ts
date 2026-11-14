/*
 * For `apps/api` only (ADR 0049): what the API needs next to the public kit so that the moved code keeps one definition.
 * Not a contract; a feature package must not import this entry (dependency-cruiser rule `features-must-not-import-api-kit-internal`).
 */
export { PROBLEM_CODES, PROBLEM_STATUS, PROBLEM_TITLE } from "./problem.js";
export {
  AUTHENTICATED_KEY,
  AuthenticatedAdminRoute,
  CATALOG_DEFAULT_PERMISSIONS,
  DEFAULTS_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
  PublicAdminRoute,
  UseDefaultPermissionByMethod,
} from "./route-access.js";
