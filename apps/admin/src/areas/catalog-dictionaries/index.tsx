import { useI18n } from "../../i18n/i18n-context";
import { NotBuiltView } from "../../views/status-views";

/** Catalog dictionaries area (plan step 5): one lazy chunk for its five screens; placeholders until that step. */

export function AttributesPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.attributes.title" />;
}

export function OptionsPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.options.title" />;
}

export function ProductTypesPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.productTypes.title" />;
}

export function BrandsPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.brands.title" />;
}

export function CategoriesPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.categories.title" />;
}
