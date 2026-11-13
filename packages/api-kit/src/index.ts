/*
 * The public entry of the API kit (ADR 0049, contract `docs/contracts/features.md`): the minimum a feature package needs
 * to raise the API's problems, declare admin permissions and reach the API's database, media and locales. Nothing else
 * is exported here on purpose; the API's own internals use `@fluxkit/api-kit/internal`, which features must not import.
 */
export {
  ProblemException,
  type FieldError,
  type ProblemCode,
  type ProblemExtensions,
  type ProblemInit,
} from "./problem.js";
export { RequirePermission, type DefaultPermissions } from "./route-access.js";
export { AdminController } from "./admin-controller.js";
export { FEATURE_DATABASE, LOCALE_CONFIG, MEDIA_PORT, type LocaleConfig } from "./tokens.js";
