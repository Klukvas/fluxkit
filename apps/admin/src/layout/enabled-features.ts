import { useCallback, useEffect, useState } from "react";
import { featureMessageFile } from "../features/manifest";
import { FeatureSliceError } from "../features/manifest-rules";
import { ADMIN_FEATURES } from "../features/registry";
import { useI18n } from "../i18n/i18n-context";
import { adminClient } from "../lib/api";
import { failureFromError, type Failure } from "../lib/failure";
import { useCrash } from "../lib/use-crash";

/**
 * Which feature slices may show (ADR 0049, E8): the slices of this build that the API lists in `GET /admin/config`
 * `features`, with their messages loaded for the UI language. `none` when the build has no slice (nothing is asked).
 */
export type EnabledFeatures =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; names: readonly string[] }
  | { status: "failed"; failure: Failure };

/** The features to show: those the API enabled that this build has a slice for, in the build's order. */
export function enabledSlices(apiFeatures: readonly string[], slices: readonly string[]): string[] {
  return slices.filter((name) => apiFeatures.includes(name));
}

/** The names a navigation may show: only once known (never while loading or after a failure). */
export function shownFeatures(state: EnabledFeatures): readonly string[] {
  return state.status === "ready" ? state.names : [];
}

/** What the shell shows for a route of a feature slice; `null` for a core route (its own permission gate decides). */
export type FeatureRouteGate = "loading" | "failed" | "notFound" | "open";

export function featureRouteGate(
  feature: string | undefined,
  state: EnabledFeatures,
): FeatureRouteGate | null {
  if (feature === undefined) return null;
  switch (state.status) {
    case "none":
      return "notFound";
    case "loading":
      return "loading";
    case "failed":
      return "failed";
    case "ready":
      return state.names.includes(feature) ? "open" : "notFound";
  }
}

/**
 * Reads the enabled features once per signed-in user (`sessionKey`), then loads the message files of the shown slices for
 * the UI language (a language switch loads them for the next one, `i18n-context.tsx`). A failed read can be retried; a
 * bug goes to the error boundary.
 */
export function useEnabledFeatures(sessionKey: string | null): {
  state: EnabledFeatures;
  retry: () => void;
} {
  const { loadMessages } = useI18n();
  const crash = useCrash();
  const hasSlices = ADMIN_FEATURES.length > 0;
  const [state, setState] = useState<EnabledFeatures>(
    hasSlices ? { status: "loading" } : { status: "none" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hasSlices || sessionKey === null) return undefined;
    const controller = new AbortController();
    let current = true;
    setState({ status: "loading" });
    async function load(): Promise<EnabledFeatures> {
      const config = await adminClient.getConfig({ signal: controller.signal });
      if (!config.ok) {
        return {
          status: "failed",
          failure: {
            kind: "problem",
            status: config.status,
            problem: config.problem,
            retryAfter: config.retryAfter,
          },
        };
      }
      const names = enabledSlices(
        config.data.features,
        ADMIN_FEATURES.map((feature) => feature.name),
      );
      try {
        await loadMessages(names.map(featureMessageFile));
      } catch (error) {
        // A message file that breaks the slice rules is a bug: the error boundary shows it (checked in development only,
        // `features/registry.ts`).
        if (import.meta.env.DEV && error instanceof FeatureSliceError) throw error;
        // A message chunk that cannot be loaded (offline, or a deployment replaced it), like an area chunk: the feature's
        // screens say so with a retry, the rest of the admin goes on. The error is logged once, with its detail.
        console.error(error);
        return { status: "failed", failure: { kind: "network" } };
      }
      return { status: "ready", names };
    }
    load().then(
      (next) => {
        if (current) setState(next);
      },
      (error: unknown) => {
        if (!current) return;
        try {
          const failure = failureFromError(error);
          if (failure !== null) setState({ status: "failed", failure });
        } catch (bug) {
          crash(bug);
        }
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [hasSlices, sessionKey, attempt, loadMessages, crash]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}
