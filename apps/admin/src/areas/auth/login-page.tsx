import { Card, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { useDocumentTitle } from "../../i18n/use-document-title";
import { describeFailure } from "../../lib/problem-messages";
import { LanguageSwitch } from "../../layout/language-switch";
import { safeNextPath } from "../../router/safe-next";
import { useSession } from "../../session/session-context";
import { FailureMessage, LoadingView, PageHeading } from "../../views/status-views";
import { SignInForm } from "./sign-in-form";

/** The page frame of the sign-in page: no navigation, the language switch, one `h1`, the form in a card. */
export function LoginFrame({
  t,
  languageSwitch,
  children,
}: {
  t: Translator;
  languageSwitch: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
        <div className="flex justify-end">{languageSwitch}</div>
        <main id="main" className="flex flex-col gap-6">
          <PageHeading>{t("auth.login.heading")}</PageHeading>
          <Card>{children}</Card>
        </main>
      </div>
    </div>
  );
}

/**
 * `/login`, the only public route. After sign-in it goes to `next` when that is a safe path of the SPA (`safeNextPath`),
 * else to the start page. Signed in already: straight on.
 */
export function LoginPage() {
  const { t } = useI18n();
  const session = useSession();
  const [params] = useSearchParams();
  useDocumentTitle("page.login.title");

  const next = params.getAll("next");
  const target = safeNextPath(next.length === 1 ? next[0] : next);

  if (session.state.status === "signedIn") return <Navigate to={target} replace />;

  let body: ReactNode;
  if (session.state.status === "loading") {
    body = <LoadingView t={t} />;
  } else if (session.state.status === "failed" && session.state.failure !== null) {
    body = (
      <FailureMessage
        t={t}
        descriptor={describeFailure(session.state.failure)}
        onRetry={session.retry}
      />
    );
  } else {
    body = <SignInForm idPrefix="login" />;
  }

  return (
    <LoginFrame t={t} languageSwitch={<LanguageSwitch />}>
      {body}
    </LoginFrame>
  );
}
