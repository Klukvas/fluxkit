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
