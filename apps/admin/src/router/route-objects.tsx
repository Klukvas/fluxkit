import type { RouteObject } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { ProtectedLayout } from "../layout/protected-layout";
import type { RouteHandle } from "../layout/shell";
import { ROUTES, type AppRoute } from "../routes";
import { SessionRoot } from "../session/session-context";
import { RootErrorBoundary, RouteErrorBoundary } from "../views/error-boundaries";
import { NotFoundView } from "../views/status-views";

export const NOT_FOUND_ROUTE_ID = "notFound";

function NotFoundPage() {
  const { t } = useI18n();
  return <NotFoundView t={t} />;
}

function toRouteObject(route: AppRoute): RouteObject {
  const handle: RouteHandle = {
    routeId: route.id,
    titleKey: route.titleKey,
    permission: route.permission,
  };
  return route.page.kind === "eager"
    ? { path: route.path, handle, Component: route.page.Component }
    : { path: route.path, handle, lazy: { Component: route.page.load } };
}

/**
 * The route table as react-router route objects (data router, `createBrowserRouter`; no framework mode, no server
 * features). `/login` sits beside the protected layout; every other route, and the not-found route for unknown paths,
 * renders inside the shell, under an error boundary that keeps the shell usable.
 */
export function buildRouteObjects(): RouteObject[] {
  const login = ROUTES.filter((route) => route.permission === "public").map(toRouteObject);
  const pages = ROUTES.filter((route) => route.permission !== "public").map(toRouteObject);
  const notFoundHandle: RouteHandle = {
    routeId: NOT_FOUND_ROUTE_ID,
    titleKey: "notFound.title",
    permission: "authenticated",
  };
  return [
    {
      Component: SessionRoot,
      ErrorBoundary: RootErrorBoundary,
      children: [
        ...login,
        {
          Component: ProtectedLayout,
          children: [
            {
              ErrorBoundary: RouteErrorBoundary,
              children: [...pages, { path: "*", handle: notFoundHandle, Component: NotFoundPage }],
            },
          ],
        },
      ],
    },
  ];
}
