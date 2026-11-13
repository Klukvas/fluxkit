import type { Translator } from "@fluxkit/ui";
import { describeFailure } from "../lib/problem-messages";
import { FailureMessage, LoadingView, NotFoundView, PageHeading } from "../views/status-views";
import type { EnabledFeatures, FeatureRouteGate } from "./enabled-features";

/**
 * What a feature slice's screen shows while the shell does not know yet that its feature is enabled (`loading`), could not
 * ask (`failed`, with a retry), or learned that it is not (`notFound`: the same page as an unknown address, as the API
 * answers `404` for the feature's routes).
 */
export function FeatureRouteFallback({
  t,
  gate,
  state,
  onRetry,
}: {
  t: Translator;
  gate: Exclude<FeatureRouteGate, "open">;
  state: EnabledFeatures;
  onRetry: () => void;
}) {
  switch (gate) {
    case "loading":
      return <LoadingView t={t} />;
    case "notFound":
      return <NotFoundView t={t} />;
    case "failed":
      return (
        <div className="flex flex-col gap-4">
          <PageHeading>{t("error.title")}</PageHeading>
          <FailureMessage
            t={t}
            descriptor={
              state.status === "failed" ? describeFailure(state.failure) : { key: "errors.network" }
            }
            onRetry={onRetry}
          />
        </div>
      );
  }
}

/** The document title key of a feature screen the gate holds back (its own title key needs its messages). */
export function fallbackTitleKey(gate: Exclude<FeatureRouteGate, "open">): string {
  switch (gate) {
    case "loading":
      return "status.loading";
    case "notFound":
      return "notFound.title";
    case "failed":
      return "error.title";
  }
}
