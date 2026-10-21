import { Container, type Translator } from "@fluxkit/ui";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { ErrorView } from "./status-views";

function reloadPage(): void {
  window.location.reload();
}

/**
 * Logs the route error in full once per error (fail loudly), not at every render of the boundary: the shell re-renders
 * it on a language switch or a session change.
 */
function useLoggedRouteError(): void {
  const error = useRouteError();
  useEffect(() => {
    console.error(error);
  }, [error]);
}

/**
 * Error boundary of the route tree (a render error of a page, or a route chunk that failed to load: a rejected lazy route,
 * see `router/route-objects.tsx`). Rendered inside the shell for page routes, so the navigation stays usable. The error is
 * logged in full, the page shows a translated message and a reload action only.
 */
export function RouteErrorBoundary() {
  const { t } = useI18n();
  useLoggedRouteError();
  return <ErrorView t={t} onReload={reloadPage} />;
}

/** The same, for errors outside the shell (the session gate, the sign-in page): a full page with `main`. */
export function RootErrorBoundary() {
  const { t } = useI18n();
  useLoggedRouteError();
  return (
    <Container className="py-10">
      <main id="main">
        <ErrorView t={t} onReload={reloadPage} />
      </main>
    </Container>
  );
}

interface AppBoundaryState {
  failed: boolean;
}

class AppBoundary extends Component<{ t: Translator; children: ReactNode }, AppBoundaryState> {
  override state: AppBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Container className="py-10">
        <main id="main">
          <ErrorView t={this.props.t} onReload={reloadPage} />
        </main>
      </Container>
    );
  }
}

/** Last line of defence around the router itself (an error in a provider). */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <AppBoundary t={t}>{children}</AppBoundary>;
}
