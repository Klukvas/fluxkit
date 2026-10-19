import { Alert, Button, Spinner, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Failure } from "../lib/failure";
import { describeFailure, type MessageDescriptor } from "../lib/problem-messages";
import { PATHS } from "../router/paths";

/**
 * Presentational building blocks for page states: props in, markup out, every word from the translator. Each full-page
 * view renders exactly one `h1` (the shell moves the focus to it after a navigation).
 */

export function PageHeading({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-bold text-foreground">{children}</h1>;
}

function PageView({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading>{title}</PageHeading>
      {children}
    </div>
  );
}

// Link text in the body color with an underline: `primary` is only checked as a non-text color (contrast.spec.ts).
const linkClass = "font-medium text-foreground underline underline-offset-4";

export function NotFoundView({ t }: { t: Translator }) {
  return (
    <PageView title={t("notFound.title")}>
      <p className="text-muted-foreground">{t("notFound.body")}</p>
      <p>
        <Link to={PATHS.home} className={linkClass}>
          {t("action.goHome")}
        </Link>
      </p>
    </PageView>
  );
}

export function NotAllowedView({ t }: { t: Translator }) {
  return (
    <PageView title={t("notAllowed.title")}>
      <p className="text-muted-foreground">{t("notAllowed.body")}</p>
      <p>
        <Link to={PATHS.home} className={linkClass}>
          {t("action.goHome")}
        </Link>
      </p>
    </PageView>
  );
}

/** A section of the navigation whose screens a later step builds. */
export function NotBuiltView({ t, titleKey }: { t: Translator; titleKey: string }) {
  return (
    <PageView title={t(titleKey)}>
      <p className="text-muted-foreground">{t("notBuilt.body")}</p>
    </PageView>
  );
}

/** A render error or a route chunk that failed to load (for example after a deployment). Uses a full reload. */
export function ErrorView({ t, onReload }: { t: Translator; onReload: () => void }) {
  return (
    <PageView title={t("error.title")}>
      <p className="text-muted-foreground">{t("error.body")}</p>
      <div>
        <Button onClick={onReload}>{t("action.reload")}</Button>
      </div>
    </PageView>
  );
}

export function LoadingView({ t }: { t: Translator }) {
  return (
    <div className="flex items-center gap-3 py-8 text-muted-foreground" aria-busy="true">
      <Spinner label={t("status.loading")} />
    </div>
  );
}

/** The message of a failed request, and for an unknown code the code itself in small print (for support). */
export function FailureMessage({
  t,
  descriptor,
  onRetry,
}: {
  t: Translator;
  descriptor: MessageDescriptor;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="danger">
      <p>{t(descriptor.key, descriptor.values)}</p>
      {descriptor.code === undefined ? null : (
        <p className="mt-1 text-sm text-muted-foreground">
          <small>{t("errors.reference", { code: descriptor.code })}</small>
        </p>
      )}
      {onRetry === undefined ? null : (
        <div className="mt-3">
          <Button variant="secondary" onClick={onRetry}>
            {t("action.retry")}
          </Button>
        </div>
      )}
    </Alert>
  );
}

/** The part of `useResource`'s answer a fallback needs (structural, so a view never depends on the hook). */
export type ResourceFallbackState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; failure: Failure }
  | { status: "forbidden" }
  | { status: "notFound" };

/**
 * What a screen shows instead of its data while a read is not `ready`: loading, the failure with a retry, "not allowed"
 * (the permissions are read again by the session) or "does not exist". `null` when ready: the screen renders its data.
 */
export function ResourceFallback({
  t,
  state,
  onRetry,
}: {
  t: Translator;
  state: ResourceFallbackState;
  onRetry: () => void;
}) {
  switch (state.status) {
    case "ready":
      return null;
    case "loading":
      return <LoadingView t={t} />;
    case "error":
      return <FailureMessage t={t} descriptor={describeFailure(state.failure)} onRetry={onRetry} />;
    case "forbidden":
      return <Alert variant="warning">{t("error.forbiddenData")}</Alert>;
    case "notFound":
      return <Alert variant="info">{t("error.notFoundData")}</Alert>;
  }
}
