import type { Translator } from "@fluxkit/ui";
import { createContext, useContext, type ReactNode } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import type { ContentLocales } from "./form-parts";

const ContentLocalesContext = createContext<ContentLocales | null>(null);

/** The content locales of the screen below (from `GET /admin/config`). */
export function useContentLocales(): ContentLocales {
  const value = useContext(ContentLocalesContext);
  if (value === null) throw new Error("useContentLocales must be used inside ConfigGate.");
  return value;
}

export function ConfigGateView({
  t,
  state,
  onRetry,
  children,
}: {
  t: Translator;
  state:
    { status: "ready"; data: ContentLocales } | Exclude<ResourceFallbackState, { status: "ready" }>;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (state.status !== "ready") return <ResourceFallback t={t} state={state} onRetry={onRetry} />;
  return (
    <ContentLocalesContext.Provider value={state.data}>{children}</ContentLocalesContext.Provider>
  );
}

/**
 * Loads the admin config once for the screen and offers the content locales to the forms below it. Every dictionary form
 * is a locale-map form, so none of them renders before the locales are known.
 */
export function ConfigGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const config = useResource((signal) => adminClient.getConfig({ signal }), []);
  return (
    <ConfigGateView
      t={t}
      state={
        config.status === "ready"
          ? {
              status: "ready",
              data: { defaultLocale: config.data.defaultLocale, locales: config.data.locales },
            }
          : config
      }
      onRetry={config.reload}
    >
      {children}
    </ConfigGateView>
  );
}
