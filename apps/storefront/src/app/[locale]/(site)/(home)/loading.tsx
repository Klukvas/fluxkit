"use client";

import { LoadingView } from "../../../components/status-views";
import { useI18n } from "../../../components/i18n-provider";

export default function SiteLoading() {
  const { t } = useI18n();
  return <LoadingView t={t} />;
}
