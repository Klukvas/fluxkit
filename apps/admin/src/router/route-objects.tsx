import type { RouteObject } from "react-router";
import { withAreaMessages } from "../i18n/area-messages";
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
  const page = route.page;
  if (page.kind === "eager") return { path: route.path, handle, Component: page.Component };
  return {
    path: route.path,
    handle,
    // The FUNCTION form of `lazy` on purpose. With the object form (`lazy: { Component }`), react-router 8.4 awaits the
    // component loader only as a side promise and swallows its rejection: the navigation ends without an error, the
    // route keeps its unresolved `lazy` and renders nothing, so a chunk that cannot be loaded (offline, or replaced by a
    // deployment) blanked the whole SPA (step 13 review, M1). A rejected lazy FUNCTION is the route's error, which the
    // nearest error boundary (`RouteErrorBoundary`, inside the shell) shows. The area renders after its message files
    // are loaded for the UI language (no missing key on screen).
    lazy: async () => {
      const loaded = await page.load();
      return { Component: withAreaMessages(loaded.Component, loaded.messageFiles) };
    },
  };
}

/**
 * The route table as react-router route objects (data router, `createBrowserRouter`; no framework mode, no server
 * features). `/login` sits beside the protected layout; every other route, and the not-found route for unknown paths,
 * renders inside the shell, under an error boundary that keeps the shell usable. `routes` is the app's table; a test
 * passes its own rows.
 */
export function buildRouteObjects(routes: readonly AppRoute[] = ROUTES): RouteObject[] {
  const login = routes.filter((route) => route.permission === "public").map(toRouteObject);
  const pages = routes.filter((route) => route.permission !== "public").map(toRouteObject);
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
