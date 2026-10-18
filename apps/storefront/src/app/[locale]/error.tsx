"use client";

import { ErrorView } from "../../components/status-views";
import { useI18n } from "../../components/i18n-provider";
import { localizedHref } from "../../lib/locale-path";

/** Renders inside the shell for any error below the locale layout (an API outage, a locale mismatch). */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { locale, t } = useI18n();
  return (
    <ErrorView t={t} digest={error.digest} homeHref={localizedHref(locale, "/")} onRetry={reset} />
  );
}
