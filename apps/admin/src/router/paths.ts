import { ADMIN_BASE_PATH } from "./base-path";

/**
 * Every route path of the SPA, relative to `ADMIN_BASE_PATH`. Components link through `pathTo` and `buildPath`, never with a
 * hand-typed string, so a renamed route is a compile error. The route table (`src/routes.ts`) adds permission, title and
 * page; this file holds only the paths so that pages can link without importing the route table (no import cycle).
 */
export const PATHS = {
  login: "/login",
  home: "/",
  account: "/account",
  products: "/products",
  attributes: "/catalog/attributes",
  options: "/catalog/options",
  productTypes: "/catalog/product-types",
  brands: "/catalog/brands",
  categories: "/catalog/categories",
  orders: "/orders",
  customers: "/customers",
  users: "/users",
} as const;

export type RouteId = keyof typeof PATHS;

/** The path of a route without parameters. */
export function pathTo(id: RouteId): string {
  return PATHS[id];
}

type ParamNames<Pattern extends string> = Pattern extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : Pattern extends `${string}:${infer Name}`
    ? Name
    : never;

type ParamArguments<Pattern extends string> = [ParamNames<Pattern>] extends [never]
  ? []
  : [params: Record<ParamNames<Pattern>, string>];

/**
 * Fills the `:name` parameters of a path pattern, each one percent-encoded (an id with `/` stays one segment). The
 * parameter names are checked by the type system; an empty value throws, because it would silently link another route.
 */
export function buildPath<Pattern extends string>(
  pattern: Pattern,
  ...args: ParamArguments<Pattern>
): string {
  const params: Record<string, string> = args[0] ?? {};
  return pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_whole, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new RangeError(`Path parameter "${name}" of ${pattern} is missing or empty.`);
    }
    return encodeURIComponent(value);
  });
}

/** The path as the browser shows it: the base path plus the route path (and its query string). */
export function browserPath(path: string): string {
  return `${ADMIN_BASE_PATH}${path}`;
}
