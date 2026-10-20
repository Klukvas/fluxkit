import { useI18n } from "../../i18n/i18n-context";
import { NotBuiltView } from "../../views/status-views";

/** Products area (plan step 6). Its own lazy chunk; a placeholder until that step fills it. */
export function ProductsPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.products.title" />;
}
