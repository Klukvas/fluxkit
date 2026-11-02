import { useEffect } from "react";
import { useI18n } from "./i18n-context";

/**
 * Sets `document.title` to "<page> · <app>" in the UI language. The one place the SPA writes the title. `text` is a page's
 * own title (already translated, see `page-title.tsx`); without it the route's title key is used.
 */
export function useDocumentTitle(titleKey: string, text: string | null = null): void {
  const { t } = useI18n();
  useEffect(() => {
    document.title = t("app.documentTitle", { page: text ?? t(titleKey) });
  }, [t, titleKey, text]);
}
