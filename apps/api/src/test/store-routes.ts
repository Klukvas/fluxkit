import type { Type } from "@nestjs/common";
import { Reflector, ModulesContainer } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { isCustomerRoute } from "../customers/auth/customer-route.js";
import { registeredRoutes, type RegisteredRoute } from "./routes.js";

export interface StoreRoute extends RegisteredRoute {
  /** True when the route or its controller is marked `@CustomerAuthenticated()`. */
  customerAuthenticated: boolean;
}

// Nest stores the paths and HTTP methods of routes under these metadata keys (`PATH_METADATA`, `METHOD_METADATA`).
const PATH_KEY = "path";
const METHOD_KEY = "method";
/** Nest's `RequestMethod` enum: GET 0, POST 1, PUT 2, DELETE 3, PATCH 4, ALL 5, OPTIONS 6, HEAD 7. */
const METHOD_NAMES = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"];

function joinPath(...parts: string[]): string {
  const joined = `/${parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part !== "")
    .join("/")}`;
  return joined;
}

/**
 * Every route of the real router under `/store`, with whether its handler (or controller) is marked
 * `@CustomerAuthenticated()`. The marking is read from the controllers' metadata and matched to the Express route by
 * method and path pattern, so a route that cannot be matched fails loudly instead of being skipped.
 */
export function storeRoutes(app: NestExpressApplication): StoreRoute[] {
  const reflector = new Reflector();
  const marked = new Map<string, boolean>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (controller === null) continue;
      const controllerPath = reflector.get<string | string[] | undefined>(PATH_KEY, controller);
      if (typeof controllerPath !== "string") continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== "function") continue;
        const methodIndex = reflector.get<number | undefined>(METHOD_KEY, handler);
        const methodPath = reflector.get<string | undefined>(PATH_KEY, handler);
        if (methodIndex === undefined || methodPath === undefined) continue;
        const key = `${METHOD_NAMES[methodIndex]} ${joinPath(controllerPath, methodPath)}`;
        marked.set(key, isCustomerRoute(reflector, handler, controller));
      }
    }
  }
  return registeredRoutes(app)
    .filter(({ pattern }) => /^\/store(\/|$)/i.test(pattern))
    .map((route) => {
      const customerAuthenticated = marked.get(`${route.method} ${route.pattern}`);
      if (customerAuthenticated === undefined) {
        throw new Error(
          `Test helper bug: cannot match ${route.method} ${route.pattern} to a controller handler`,
        );
      }
      return { ...route, customerAuthenticated };
    });
}
