import { useEffect, type ComponentType, type ReactNode } from "react";
import type { LazyFile } from "../messages";
import { useCrash } from "../lib/use-crash";
import { LoadingView } from "../views/status-views";
import { useI18n } from "./i18n-context";

/**
 * Renders an area only once its lazy message files are loaded for the UI language; meanwhile the shell's loading view. A
 * file that cannot be loaded (offline, a deployment replaced the chunk) goes to the route's error boundary, like a route
 * chunk that failed to load.
 */
export function AreaMessages({
  files,
  children,
}: {
  files: readonly LazyFile[];
  children: ReactNode;
}) {
  const { t, hasMessages, loadMessages } = useI18n();
  const crash = useCrash();
  const ready = hasMessages(files);
  useEffect(() => {
    if (!ready) loadMessages(files).catch(crash);
  }, [ready, files, loadMessages, crash]);
  return ready ? children : <LoadingView t={t} />;
}

/** The page of a lazy route, wrapped so it renders after its message files (none: the page itself). */
export function withAreaMessages(Page: ComponentType, files: readonly LazyFile[]): ComponentType {
  if (files.length === 0) return Page;
  function AreaPage() {
    return (
      <AreaMessages files={files}>
        <Page />
      </AreaMessages>
    );
  }
  return AreaPage;
}
