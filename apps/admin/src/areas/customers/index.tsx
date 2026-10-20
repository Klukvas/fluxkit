import { useI18n } from "../../i18n/i18n-context";
import { NotBuiltView } from "../../views/status-views";

/** Customers area (plan step 9). Its own lazy chunk; a placeholder until that step fills it. */
export function CustomersPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.customers.title" />;
}
