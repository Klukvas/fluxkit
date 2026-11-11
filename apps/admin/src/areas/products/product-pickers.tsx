import type { AdminBrand, AdminProductType, AdminResult, LocalizedText } from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import { Link } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { useResource } from "../../lib/use-resource";
import { useContentLocales } from "../catalog-dictionaries/config-gate";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import { ServerPicker } from "../catalog-dictionaries/server-picker";
import { PATHS } from "../../router/paths";
import { GENERAL_FIELD_IDS } from "./field-ids";
import { useCan } from "./use-can";
import { inlineLinkClass } from "../../views/links";

/** A short form of an id, for a reference whose name is not known (support can match it). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

interface Named {
  name: LocalizedText;
  slug?: string;
  code?: string;
}

/**
 * The label of an id that may not be on a picker's loaded pages (a filter from the URL, the stored brand of a product):
 * one read; its short id while that read runs or when it fails.
 */
export function useSelectedLabel<T extends Named>(
  id: string | undefined,
  read: (id: string, signal: AbortSignal) => Promise<AdminResult<T>>,
): { value: string; label: string } | null {
  const { locale } = useI18n();
  const content = useContentLocales();
  const resource = useResource<T | null>(
    (signal) =>
      id === undefined ? Promise.resolve({ ok: true, status: 200, data: null }) : read(id, signal),
    [id],
  );
  if (id === undefined) return null;
  if (resource.status !== "ready" || resource.data === null) {
    return { value: id, label: shortId(id) };
  }
  const named = resource.data;
  return {
    value: id,
    label:
      resolveLocalized(named.name, locale, content.defaultLocale) ||
      named.slug ||
      named.code ||
      shortId(id),
  };
}

/** The brand of a product: the paged brand list, "No brand" first. */
export function BrandPicker({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error?: MessageDescriptor;
}) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const selected = useSelectedLabel(value === "" ? undefined : value, (id, signal) =>
    adminClient.getBrand(id, { signal }),
  );
  return (
    <ServerPicker<AdminBrand>
      t={t}
      id={GENERAL_FIELD_IDS.brand}
      name="brandId"
      label={t("products.form.brand")}
      value={value}
      selected={selected}
      onChange={onChange}
      fetchPage={(offset, limit, signal) => adminClient.listBrands({ offset, limit, signal })}
      keyOf={(brand) => brand.id}
      labelOf={(brand) => resolveLocalized(brand.name, locale, content.defaultLocale) || brand.slug}
      emptyChoiceLabel={t("products.form.noBrand")}
      disabled={disabled}
      error={error}
    />
  );
}

/**
 * "No suitable type? Create a product type" under the type field of a new product, for an admin who may create one. The
 * create screen is another page: the unsaved-changes guard asks before leaving, and the text says the typed values are not
 * kept (keeping them would need a draft store the admin does not have).
 */
export function ProductTypeCreateLinkView({ t, canCreate }: { t: Translator; canCreate: boolean }) {
  if (!canCreate) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {t("products.form.productTypeMissing")}{" "}
      <Link to={PATHS.productTypeNew} className={inlineLinkClass}>
        {t("products.form.productTypeCreate")}
      </Link>{" "}
      {t("products.form.productTypeCreateNote")}
    </p>
  );
}

/** The product type of a new product (required; it cannot change later). */
export function ProductTypePicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: MessageDescriptor;
}) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canCreate = useCan("createProductType");
  return (
    <div className="flex flex-col gap-2">
      <ServerPicker<AdminProductType>
        t={t}
        id={GENERAL_FIELD_IDS.productType}
        name="productTypeId"
        label={t("products.form.productType")}
        hint={t("products.form.productTypeHint")}
        value={value}
        onChange={onChange}
        fetchPage={(offset, limit, signal) =>
          adminClient.listProductTypes({ offset, limit, signal })
        }
        keyOf={(type) => type.id}
        labelOf={(type) =>
          t("products.form.productTypeChoice", {
            name: resolveLocalized(type.name, locale, content.defaultLocale) || type.code,
            code: type.code,
          })
        }
        required
        error={error}
      />
      <ProductTypeCreateLinkView t={t} canCreate={canCreate} />
    </div>
  );
}
