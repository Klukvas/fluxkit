import type { HttpOptions } from "./http.js";
import type { NestExpressApplication } from "@nestjs/platform-express";

export const SOME_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";

interface ExpressLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

export interface RegisteredRoute {
  method: string;
  /** Route pattern with `:param` placeholders, as registered. */
  pattern: string;
  /** The pattern with every parameter replaced by a well-formed UUID, ready to call. */
  path: string;
}

/** Every `METHOD path` registered on the real Express router. */
export function registeredRoutes(app: NestExpressApplication): RegisteredRoute[] {
  const router = (app.getHttpAdapter().getInstance() as { router: { stack: ExpressLayer[] } })
    .router;
  const routes: RegisteredRoute[] = [];
  for (const layer of router.stack) {
    if (layer.route === undefined) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push({
        method: method.toUpperCase(),
        pattern: layer.route.path,
        path: layer.route.path.replace(/:[A-Za-z]+/g, SOME_ID),
      });
    }
  }
  return routes;
}

export function adminRoutes(app: NestExpressApplication): RegisteredRoute[] {
  return registeredRoutes(app).filter(({ path }) => path.startsWith("/admin"));
}

/** The one admin route that takes a raw `application/octet-stream` body instead of JSON (ADR 0028 decision 4). */
export const BINARY_UPLOAD_ROUTE = "/admin/media/uploads";

/**
 * TEST ONLY. What a route sweep sends to call `METHOD path` with "some body": nothing for GET and DELETE, a JSON `{}` for
 * the other writes, and a few raw bytes as `application/octet-stream` to the upload route, whose CSRF rule refuses JSON.
 */
export function sweepRequest(method: string, path: string): HttpOptions {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "DELETE") {
    return {};
  }
  if (upper === "POST" && path === BINARY_UPLOAD_ROUTE) {
    return { rawBody: "not an image", contentType: "application/octet-stream" };
  }
  return { body: {} };
}
