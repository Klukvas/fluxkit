import { useState, type FormEvent } from "react";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { jsonEqual } from "../../../lib/diff-for-patch";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { hasIssues } from "../../catalog-dictionaries/form-rules";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import {
  productFieldNames,
  productFormFrom,
  productPatchBody,
  validateProductForm,
  type ProductFormValues,
} from "../product-form";
import { ProductGeneralView } from "../product-general-view";
import { BrandPicker } from "../product-pickers";
import { problemsOnTab } from "../publish-problems";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { useCan } from "../use-can";

/**
 * General: title, description, slug and brand. Saves with a PATCH of the changed fields only (`diffForPatch`); a locale
 * map is sent whole. Read-only for an admin who may not update products. The editor remounts the tab after a save (keyed
 * by the product's `updatedAt`), so the form shows what the server stored.
 */
export function GeneralTab({
  product,
  content,
  problems,
  onChanged,
  onDirtyChange,
}: ProductTabProps) {
  const { t, locale } = useI18n();
  const canWrite = useCan("updateProduct");
  const [initial, setInitial] = useState(() => productFormFrom(product, content.locales));
  const [values, setValues] = useState<ProductFormValues>(initial);
  const form = useFormSubmit(productFieldNames(content.locales));
  const dirty = !jsonEqual(initial, values) && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);
  const issues = { ...problemsOnTab(problems, "general"), ...form.state.fieldErrors };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const local = validateProductForm(values, content, "edit");
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    const body = productPatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateProduct(product.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <ProductGeneralView
        t={t}
        uiLocale={locale}
        content={content}
        mode="edit"
        values={values}
        onChange={setValues}
        issues={issues}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        onSubmit={(event) => void submit(event)}
        brandPicker={
          <BrandPicker
            value={values.brandId}
            onChange={(brandId) => setValues({ ...values, brandId })}
            disabled={!canWrite}
            error={issues["brandId"]}
          />
        }
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
