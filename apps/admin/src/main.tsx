import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { I18nProvider, browserStorage } from "./i18n/i18n-context";
import { initialLocale } from "./i18n/locale-preference";
import { ADMIN_BASE_PATH } from "./router/base-path";
import { buildRouteObjects } from "./router/route-objects";
import { AppErrorBoundary } from "./views/error-boundaries";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root element #root not found");
}

const router = createBrowserRouter(buildRouteObjects(), { basename: ADMIN_BASE_PATH });

createRoot(container).render(
  <StrictMode>
    <I18nProvider initial={initialLocale(browserStorage, navigator.languages)}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
