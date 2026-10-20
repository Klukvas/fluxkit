import { Container } from "@fluxkit/ui";
import { Navigate, useLocation } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { describeFailure } from "../lib/problem-messages";
import { currentRelativePath, loginPath } from "../router/safe-next";
import { useSession } from "../session/session-context";
import { FailureMessage, LoadingView, PageHeading } from "../views/status-views";
import { Shell } from "./shell";

/**
 * Gate of every route except `/login`: while `me` loads, a loading state; nobody signed in (401), the sign-in page with
 * this page as `next`; `me` could not be read, an error with retry; otherwise the shell.
 */
export function ProtectedLayout() {
  const { t } = useI18n();
  const session = useSession();
  const location = useLocation();
  const { status, failure } = session.state;

  if (status === "signedOut") {
    return (
      <Navigate to={loginPath(currentRelativePath(location.pathname, location.search))} replace />
    );
  }
  if (status === "loading") {
    return (
      <Container className="py-10">
        <main id="main">
          <LoadingView t={t} />
        </main>
      </Container>
    );
  }
  if (status === "failed") {
    return (
      <Container className="flex flex-col gap-4 py-10">
        <main id="main" className="flex flex-col gap-4">
          <PageHeading>{t("shell.sessionFailed")}</PageHeading>
          {failure === null ? null : (
            <FailureMessage t={t} descriptor={describeFailure(failure)} onRetry={session.retry} />
          )}
        </main>
      </Container>
    );
  }
  return <Shell />;
}
