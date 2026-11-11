"use client";

import { useEffect, useState } from "react";
import { LoadingView } from "../../../../components/status-views";
import { useI18n } from "../../../../components/i18n-provider";

/**
 * How long a navigation may take before its placeholder shows, like the admin's `LOADING_REVEAL_DELAY_MS`: a fast one never
 * flashes it (council decision 7, docs/plans/2026-11-11-ui-council-decisions.md).
 */
const LOADING_REVEAL_DELAY_MS = 200;

export default function SiteLoading() {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), LOADING_REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  // Hidden, not absent: the placeholder keeps its screen-tall box, so the footer stays below the fold either way.
  return (
    <div className={revealed ? undefined : "invisible"}>
      <LoadingView t={t} />
    </div>
  );
}
