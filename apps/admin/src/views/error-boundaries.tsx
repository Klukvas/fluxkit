import { Container, type Translator } from "@fluxkit/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { ErrorView } from "./status-views";

function reloadPage(): void {
  window.location.reload();
}

/**
 * Error boundary of the route tree (a render error of a page, or a route chunk that failed to load). Rendered inside the
 * shell for page routes, so the navigation stays usable. The error is logged in full (fail loudly), the page shows a
 * translated message only.
 */
export function RouteErrorBoundary() {
  const { t } = useI18n();
  const error = useRouteError();
  console.error(error);
  return <ErrorView t={t} onReload={reloadPage} />;
}

/** The same, for errors outside the shell (the session gate, the sign-in page): a full page with `main`. */
export function RootErrorBoundary() {
  const { t } = useI18n();
  const error = useRouteError();
  console.error(error);
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
