import { useEffect } from "react";
import { useI18n } from "./i18n-context";

/** Sets `document.title` to "<page> · <app>" in the UI language. The one place the SPA writes the title. */
export function useDocumentTitle(titleKey: string): void {
  const { t } = useI18n();
  useEffect(() => {
    document.title = t("app.documentTitle", { page: t(titleKey) });
  }, [t, titleKey]);
}
