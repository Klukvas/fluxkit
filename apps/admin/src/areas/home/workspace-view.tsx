import { Button, CustomersIcon, OrdersIcon, PlusIcon, type Translator } from "@fluxkit/ui";
import { useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { describeFailure } from "../../lib/problem-messages";
import type { ResourceView } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { secondaryLinkClass, standaloneLinkClass } from "../../views/links";
import type { WorkspaceAction, WorkspaceCounter } from "./workspace-model";

const actionIcons = { newProduct: PlusIcon, processOrders: OrdersIcon, customers: CustomersIcon };

export function CounterView({
  t,
  counter,
  state,
  total,
  onRetry,
}: {
  t: Translator;
  counter: WorkspaceCounter;
  state: ResourceView<{ total: number }>;
  total?: string;
  onRetry: () => void;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const label = t(`home.counter.${counter.id}`);
  const failure = state.status === "error" ? describeFailure(state.failure) : null;
  const value =
    state.status === "ready"
      ? total
      : t(
          state.status === "loading"
            ? "home.counter.loading"
            : state.status === "forbidden"
              ? "home.counter.forbidden"
              : "home.counter.unavailable",
        );
  return (
    <div
      className="min-w-0 rounded-card border border-border bg-background"
      aria-busy={state.status === "loading"}
    >
      <Link
        ref={linkRef}
        to={counter.target}
        className="flex min-h-11 flex-col gap-2 rounded-card p-4 text-foreground wrap-break-word hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          className={
            state.status === "ready"
              ? "text-2xl font-bold tabular-nums"
              : "text-sm text-muted-foreground"
          }
        >
          {value}
        </span>
        <span className="font-medium">{label}</span>
      </Link>
      {failure === null ? null : (
        <div className="px-4 pb-2 text-sm text-muted-foreground">
          <p>{t(failure.key, failure.values)}</p>
          {failure.code === undefined ? null : (
            <p>{t("errors.reference", { code: failure.code })}</p>
          )}
        </div>
      )}
      {state.status === "error" || state.status === "notFound" ? (
        <div className="px-4 pb-4">
          <Button
            variant="ghost"
            className="pointer-coarse:min-h-11"
            aria-label={t("home.counter.retry", { label })}
            onClick={() => {
              // Retry disappears while loading: keep keyboard focus in this card before starting that read.
              linkRef.current?.focus();
              onRetry();
            }}
          >
            {t("action.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceView({
  t,
  counters,
  actions,
}: {
  t: Translator;
  counters: readonly ReactNode[];
  actions: readonly WorkspaceAction[];
}) {
  return (
    <div className="min-w-0 space-y-6">
      {counters.length === 0 ? null : (
        <section aria-labelledby="home-counters-title" className="space-y-3">
          <h2 id="home-counters-title" className="text-lg font-semibold text-foreground">
            {t("home.counters.title")}
          </h2>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {counters}
          </div>
        </section>
      )}
      {actions.length === 0 ? null : (
        <section aria-labelledby="home-actions-title" className="space-y-3">
          <h2 id="home-actions-title" className="text-lg font-semibold text-foreground">
            {t("home.actions.title")}
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {actions.map((action) => {
              const Icon = actionIcons[action.id];
              return (
                <Link key={action.id} to={action.target} className={secondaryLinkClass}>
                  <span
                    aria-hidden="true"
                    className="inline-flex size-5 shrink-0 items-center justify-center"
                  >
                    <Icon />
                  </span>
                  {t(`home.action.${action.id}`)}
                </Link>
              );
            })}
          </div>
        </section>
      )}
      {counters.length > 0 || actions.length > 0 ? null : (
        <div className="space-y-2">
          <p className="text-muted-foreground">{t("home.noAccess")}</p>
          <Link to={PATHS.help} className={standaloneLinkClass}>
            {t("home.openHelp")}
          </Link>
        </div>
      )}
    </div>
  );
}
