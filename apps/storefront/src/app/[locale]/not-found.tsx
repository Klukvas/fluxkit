"use client";

import { NotFoundView } from "../../components/status-views";
import { useI18n } from "../../components/i18n-provider";
import { localizedHref } from "../../lib/locale-path";

export default function LocaleNotFound() {
  const { locale, t } = useI18n();
  return <NotFoundView t={t} homeHref={localizedHref(locale, "/")} />;
}
