import type {
  AdminOptionWithValues,
  AdminProduct,
  AdminResult,
  AdminVariant,
  UpdateAdminVariantBody,
} from "@fluxkit/api-client";
import {
  Button,
  Checkbox,
  DataTable,
  Field,
  Select,
  StatusBadge,
  type Translator,
} from "@fluxkit/ui";
import { useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { jsonEqual } from "../../../lib/diff-for-patch";
import { describeProblem, type MessageDescriptor } from "../../../lib/problem-messages";
import { runWrite } from "../../../lib/run-write";
import { useCrash } from "../../../lib/use-crash";
import { useFocusAfterCommit } from "../../../lib/use-focus-after-commit";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { FailureMessage } from "../../../views/status-views";
import { ConfirmDelete } from "../../catalog-dictionaries/form-dialog";
import {
  FormActions,
  FormErrorSummary,
  TextField,
  describe,
  type ContentLocales,
} from "../../catalog-dictionaries/form-parts";
import { hasIssues, type FormIssues } from "../../catalog-dictionaries/form-rules";
import { resolveLocalized } from "../../catalog-dictionaries/locale-text";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import { AttributeFieldList } from "../attribute-fields-view";
import {
  attributeDisplay,
  attributeFieldNames,
  attributeFieldSpecs,
  attributeFormFrom,
  attributesDirty,
  attributesPatchBody,
  validateAttributeForm,
  type AttributeFieldSpec,
  type AttributeFormValues,
} from "../attribute-values-form";
import { TabProblemsView } from "../editor-views";
import { VARIANTS_FOCUS_ID, variantRowFocusId } from "../field-ids";
import { variantIssues, variantProblems, type PublishProblem } from "../publish-problems";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { useCan } from "../use-can";
import { optionName, useOptionDefinitions, valueLabel } from "../use-option-definitions";
import {
  BARCODE_MAX_LENGTH,
  SKU_MAX_LENGTH,
  activeToggle,
  defaultBlock,
  deleteBlock,
  newVariantValues,
  normalizeSku,
  validateVariantCreate,
  validateVariantForm,
  variantCreateBody,
  variantErrorsFromProblem,
  variantFormFrom,
  variantPatchBody,
  type VariantCreateValues,
  type VariantFormValues,
} from "../variant-form";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** What the variant views need to name option values and attribute values. */
export interface VariantNaming {
  uiLocale: string;
  content: ContentLocales;
  options: ReadonlyMap<string, AdminOptionWithValues>;
}

/** The row actions the session may run (each one only when its operation is permitted). */
export interface VariantRowActions {
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  onEdit: (variant: AdminVariant) => void;
  onMakeDefault: (variant: AdminVariant) => void;
  onToggleActive: (variant: AdminVariant, next: boolean) => void;
  onDelete: (variant: AdminVariant) => void;
}

export function optionValuesText(naming: VariantNaming, variant: AdminVariant): string {
  return variant.optionValues
    .map((value) =>
      valueLabel(
        naming.options.get(value.optionId),
        value.optionValueId,
        value.valueCode,
        naming.uiLocale,
        naming.content.defaultLocale,
      ),
    )
    .join(" / ");
}

function attributesCell(
  t: Translator,
  naming: VariantNaming,
  specs: readonly AttributeFieldSpec[],
  variant: AdminVariant,
) {
  const lines = specs.flatMap((spec) => {
    const shown = attributeDisplay(
      spec,
      variant.attributes[spec.code],
      naming.uiLocale,
      naming.content.defaultLocale,
    );
    const text = typeof shown === "string" ? shown : describe(t, shown);
    if (text === "" && !spec.isRequired) return [];
    return [{ spec, text }];
  });
  if (lines.length === 0)
    return <span className="text-muted-foreground">{t("products.variants.noAttributes")}</span>;
  return (
    <ul className="flex flex-col gap-1">
      {lines.map(({ spec, text }) => {
        const name =
          resolveLocalized(spec.name, naming.uiLocale, naming.content.defaultLocale) || spec.code;
        return (
          <li key={spec.code}>
            {text === "" ? (
              <span className="text-danger">
                {t("products.variants.attributeMissing", { name })}
              </span>
            ) : (
              t("products.variants.attributeValue", { name, value: text })
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RowActions({
  t,
  product,
  variant,
  actions,
}: {
  t: Translator;
  product: AdminProduct;
  variant: AdminVariant;
  actions: VariantRowActions;
}) {
  const sku = variant.sku;
  const makeDefault = defaultBlock(product, variant);
  const toggle = activeToggle(product, variant);
  const removal = deleteBlock(product, variant);
  const hints: string[] = [];
  if (actions.canEdit && makeDefault === "default_variant_inactive") {
    hints.push(t("products.variants.hint.defaultNeedsActive"));
  }
  if (actions.canEdit && toggle.block !== null)
    hints.push(t(`products.variants.hint.${toggle.block}`));
  if (actions.canDelete && removal !== null) hints.push(t(`products.variants.hint.${removal}`));
  if (!actions.canEdit && !actions.canDelete) return null;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("products.variants.rowActions", { sku })}
        className="flex flex-wrap gap-2"
      >
        {actions.canEdit ? (
          <Button
            variant="secondary"
            disabled={actions.busy}
            aria-label={t("products.variants.editLabel", { sku })}
            onClick={() => actions.onEdit(variant)}
          >
            {t("products.variants.edit")}
          </Button>
        ) : null}
        {actions.canEdit && makeDefault === null ? (
          <Button
            variant="secondary"
            disabled={actions.busy}
            aria-label={t("products.variants.makeDefaultLabel", { sku })}
            onClick={() => actions.onMakeDefault(variant)}
          >
            {t("products.variants.makeDefault")}
          </Button>
        ) : null}
        {actions.canEdit && toggle.block === null ? (
          <Button
            variant="secondary"
            disabled={actions.busy}
            aria-label={t(
              toggle.next ? "products.variants.activateLabel" : "products.variants.deactivateLabel",
              { sku },
            )}
            onClick={() => actions.onToggleActive(variant, toggle.next)}
          >
            {t(toggle.next ? "products.variants.activate" : "products.variants.deactivate")}
          </Button>
        ) : null}
        {actions.canDelete && removal === null ? (
          <Button
            variant="danger"
            disabled={actions.busy}
            aria-label={t("products.variants.deleteLabel", { sku })}
            onClick={() => actions.onDelete(variant)}
          >
            {t("products.variants.delete")}
          </Button>
        ) : null}
      </div>
      {hints.map((hint) => (
        <p key={hint} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ))}
    </div>
  );
}

/**
 * The variants in the product detail's order (the order the API's `variants.N` counts in; at most 250, one read): row
 * number, SKU (the row header, the focus target of the row's publish problems), option values, barcode, status and
 * default as text, stock flags, variant attributes (a required one that is missing is marked), the row's publish
 * problems, and the actions the session may run. Prices and stock are on their own tabs.
 */
export function VariantsTableView({
  t,
  naming,
  product,
  specs,
  problems,
  actions,
}: {
  t: Translator;
  naming: VariantNaming;
  product: AdminProduct;
  specs: readonly AttributeFieldSpec[];
  problems: readonly PublishProblem[];
  actions: VariantRowActions;
}) {
  const index = new Map(product.variants.map((variant, at) => [variant.id, at]));
  const yesNo = (value: boolean) => t(value ? "products.attributes.yes" : "products.attributes.no");
  return (
    <DataTable
      caption={t("products.variants.caption", { count: product.variants.length })}
      columns={[
        {
          id: "row",
          header: t("products.variants.columnRow"),
          cell: (variant) => (index.get(variant.id) ?? 0) + 1,
        },
        {
          id: "sku",
          header: t("products.variants.columnSku"),
          cell: (variant) => (
            <span
              id={variantRowFocusId(variant.id)}
              tabIndex={-1}
              className={`font-medium ${focusClass}`}
            >
              {variant.sku}
            </span>
          ),
        },
        {
          id: "values",
          header: t("products.variants.columnValues"),
          cell: (variant) =>
            variant.optionValues.length === 0 ? (
              <span className="text-muted-foreground">{t("products.variants.noOptions")}</span>
            ) : (
              optionValuesText(naming, variant)
            ),
        },
        {
          id: "barcode",
          header: t("products.variants.columnBarcode"),
          cell: (variant) => variant.barcode ?? "",
        },
        {
          id: "status",
          header: t("products.variants.columnStatus"),
          cell: (variant) => (
            <span className="flex flex-wrap gap-2">
              <StatusBadge
                tone={variant.isActive ? "success" : "neutral"}
                label={t(
                  variant.isActive ? "products.variants.active" : "products.variants.inactive",
                )}
              />
              {variant.isDefault ? (
                <StatusBadge tone="neutral" label={t("products.variants.default")} />
              ) : null}
            </span>
          ),
        },
        {
          id: "stock",
          header: t("products.variants.columnStock"),
          cell: (variant) => (
            <ul className="flex flex-col gap-1">
              <li>
                {t("products.variants.tracksStock", { value: yesNo(variant.trackInventory) })}
              </li>
              <li>{t("products.variants.backorders", { value: yesNo(variant.allowBackorder) })}</li>
            </ul>
          ),
        },
        {
          id: "attributes",
          header: t("products.variants.columnAttributes"),
          cell: (variant) => attributesCell(t, naming, specs, variant),
        },
        {
          id: "problems",
          header: t("products.variants.columnProblems"),
          cell: (variant) => {
            const own = variantProblems(problems, variant.id);
            if (own.length === 0) return null;
            return (
              <ul className="flex flex-col gap-1 text-danger">
                {own.map((problem, at) => (
                  <li key={`${problem.path}-${at}`}>
                    {problem.attributeCode === undefined
                      ? describe(t, problem.message)
                      : t("products.variants.attributeProblem", {
                          code: problem.attributeCode,
                          message: describe(t, problem.message),
                        })}
                  </li>
                ))}
              </ul>
            );
          },
        },
      ]}
      rows={product.variants}
      rowKey={(variant) => variant.id}
      rowHeaderColumnId="sku"
      emptyMessage={t("products.variants.none")}
      actions={
        actions.canEdit || actions.canDelete
          ? {
              header: t("products.variants.columnActions"),
              render: (variant) => (
                <RowActions t={t} product={product} variant={variant} actions={actions} />
              ),
            }
          : undefined
      }
    />
  );
}

export interface VariantEditorViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  variant: AdminVariant;
  values: VariantFormValues;
  onChange: (next: VariantFormValues) => void;
  specs: readonly AttributeFieldSpec[];
  attributes: AttributeFormValues;
  onAttributesChange: (next: AttributeFormValues) => void;
  mode: "draft" | "publish";
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

/**
 * One variant's form: SKU (normalized like the API: trimmed, upper case), barcode, the flags, and the variant-level
 * attributes generated from the product type (`level=variant`, the same model as the product's). Saved with a PATCH of
 * the changed fields only.
 */
export function VariantEditorView({
  t,
  uiLocale,
  content,
  variant,
  values,
  onChange,
  specs,
  attributes,
  onAttributesChange,
  mode,
  issues,
  summary,
  summaryRef,
  busy,
  onSubmit,
  onCancel,
}: VariantEditorViewProps) {
  const normalized = normalizeSku(values.sku);
  return (
    <section aria-labelledby="product-variant-editor" className="flex flex-col gap-4">
      <h2 id="product-variant-editor" className="text-lg font-semibold">
        {t("products.variants.editTitle", { sku: variant.sku })}
      </h2>
      <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
        <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
        <TextField
          t={t}
          id="variant-sku"
          name="sku"
          label={t("products.variants.sku")}
          hint={
            normalized === values.sku || normalized === ""
              ? t("products.variants.skuHint", { max: SKU_MAX_LENGTH })
              : t("products.variants.skuNormalized", { sku: normalized })
          }
          value={values.sku}
          required
          maxLength={SKU_MAX_LENGTH + 8}
          error={issues["sku"]}
          onChange={(sku) => onChange({ ...values, sku })}
        />
        <TextField
          t={t}
          id="variant-barcode"
          name="barcode"
          label={t("products.variants.barcode")}
          hint={t("products.variants.barcodeHint", { max: BARCODE_MAX_LENGTH })}
          value={values.barcode}
          maxLength={BARCODE_MAX_LENGTH}
          error={issues["barcode"]}
          onChange={(barcode) => onChange({ ...values, barcode })}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{t("products.variants.flags")}</legend>
          <Checkbox
            id="variant-isActive"
            name="isActive"
            label={t("products.variants.isActive")}
            checked={values.isActive}
            disabled={variant.isDefault && mode === "publish"}
            onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
          />
          <Checkbox
            id="variant-trackInventory"
            name="trackInventory"
            label={t("products.variants.trackInventory")}
            checked={values.trackInventory}
            onChange={(event) => onChange({ ...values, trackInventory: event.target.checked })}
          />
          <Checkbox
            id="variant-allowBackorder"
            name="allowBackorder"
            label={t("products.variants.allowBackorder")}
            checked={values.allowBackorder}
            onChange={(event) => onChange({ ...values, allowBackorder: event.target.checked })}
          />
        </fieldset>
        {specs.length === 0 ? (
          <p className="text-muted-foreground">{t("products.variants.noAttributeFields")}</p>
        ) : (
          <fieldset className="flex flex-col gap-6">
            <legend className="font-medium">{t("products.variants.attributes")}</legend>
            <AttributeFieldList
              t={t}
              uiLocale={uiLocale}
              content={content}
              specs={specs}
              values={attributes}
              onChange={onAttributesChange}
              issues={issues}
              canWrite
              mode={mode}
              idPrefix="variant-attribute"
            />
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <FormActions
            t={t}
            busy={busy}
            submitLabel={t("products.variants.save")}
            busyLabel={t("products.form.saving")}
          />
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t("dict.form.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}

export interface VariantCreateViewProps {
  t: Translator;
  naming: VariantNaming;
  product: AdminProduct;
  values: VariantCreateValues;
  onChange: (next: VariantCreateValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

/** A new variant of a draft product: one value of every option, an optional SKU (the API proposes one), the flags. */
export function VariantCreateView({
  t,
  naming,
  product,
  values,
  onChange,
  issues,
  summary,
  summaryRef,
  busy,
  onSubmit,
  onCancel,
}: VariantCreateViewProps) {
  const options = [...product.options].sort((left, right) => left.position - right.position);
  const combination = issues["optionValueIds"];
  return (
    <section aria-labelledby="product-variant-create" className="flex flex-col gap-4">
      <h2 id="product-variant-create" className="text-lg font-semibold">
        {t("products.variants.createTitle")}
      </h2>
      <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
        <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
        {options.map((option) => {
          const error = issues[`optionValueIds.${option.optionId}`];
          return (
            <Field
              key={option.optionId}
              id={`variant-new-${option.optionCode}`}
              label={optionName(
                naming.options.get(option.optionId),
                option.optionCode,
                naming.uiLocale,
                naming.content.defaultLocale,
              )}
              required
              requiredIndicator={t("dict.form.requiredMark")}
              error={error === undefined ? undefined : describe(t, error)}
            >
              {(control) => (
                <Select
                  {...control}
                  value={values.valueIds[option.optionId] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      valueIds: { ...values.valueIds, [option.optionId]: event.target.value },
                    })
                  }
                >
                  <option value="">{t("products.variants.chooseValue")}</option>
                  {[...option.values]
                    .sort((left, right) => left.position - right.position)
                    .map((value) => (
                      <option key={value.optionValueId} value={value.optionValueId}>
                        {valueLabel(
                          naming.options.get(option.optionId),
                          value.optionValueId,
                          value.valueCode,
                          naming.uiLocale,
                          naming.content.defaultLocale,
                        )}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          );
        })}
        {combination === undefined ? null : (
          <p className="text-danger">{describe(t, combination)}</p>
        )}
        <TextField
          t={t}
          id="variant-new-sku"
          name="sku"
          label={t("products.variants.sku")}
          hint={t("products.variants.skuProposed")}
          value={values.sku}
          maxLength={SKU_MAX_LENGTH + 8}
          error={issues["sku"]}
          onChange={(sku) => onChange({ ...values, sku })}
        />
        <TextField
          t={t}
          id="variant-new-barcode"
          name="barcode"
          label={t("products.variants.barcode")}
          value={values.barcode}
          maxLength={BARCODE_MAX_LENGTH}
          error={issues["barcode"]}
          onChange={(barcode) => onChange({ ...values, barcode })}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{t("products.variants.flags")}</legend>
          <Checkbox
            id="variant-new-isActive"
            label={t("products.variants.isActive")}
            checked={values.isActive}
            onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
          />
          <Checkbox
            id="variant-new-trackInventory"
            label={t("products.variants.trackInventory")}
            checked={values.trackInventory}
            onChange={(event) => onChange({ ...values, trackInventory: event.target.checked })}
          />
          <Checkbox
            id="variant-new-allowBackorder"
            label={t("products.variants.allowBackorder")}
            checked={values.allowBackorder}
            onChange={(event) => onChange({ ...values, allowBackorder: event.target.checked })}
          />
        </fieldset>
        <p className="text-sm text-muted-foreground">
          {t("products.variants.createAttributesLater")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <FormActions
            t={t}
            busy={busy}
            submitLabel={t("products.variants.create")}
            busyLabel={t("products.form.saving")}
          />
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t("dict.form.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** The edit form of one variant, with its own unsaved-changes guard and dirty report. */
function VariantEditor({
  variant,
  product,
  specs,
  content,
  problems,
  onChanged,
  onDirtyChange,
  onCancel,
}: {
  variant: AdminVariant;
  product: AdminProduct;
  specs: readonly AttributeFieldSpec[];
  content: ContentLocales;
  problems: readonly PublishProblem[];
  onChanged: ProductTabProps["onChanged"];
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [initial, setInitial] = useState(() => variantFormFrom(variant));
  const [values, setValues] = useState<VariantFormValues>(initial);
  const [initialAttributes, setInitialAttributes] = useState(() =>
    attributeFormFrom(specs, variant.attributes, content.locales),
  );
  const [attributes, setAttributes] = useState<AttributeFormValues>(initialAttributes);
  const fieldNames = useMemo(
    () => [
      "sku",
      "barcode",
      "isActive",
      "trackInventory",
      "allowBackorder",
      ...attributeFieldNames(specs, content.locales),
    ],
    [specs, content.locales],
  );
  const form = useFormSubmit(fieldNames, variantErrorsFromProblem);
  const mode = product.status === "active" ? "publish" : "draft";
  const changedAttributes = attributesDirty(initialAttributes, attributes);
  const dirty =
    (changedAttributes || Object.keys(variantPatchBody(variant, values)).length > 0) &&
    !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);
  const issues = { ...variantIssues(problems, variant.id), ...form.state.fieldErrors };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const local = {
      ...validateVariantForm(values),
      ...(changedAttributes || (values.isActive && !variant.isActive)
        ? validateAttributeForm(specs, attributes, { ...content, mode })
        : {}),
    };
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    const attributeBody: Pick<UpdateAdminVariantBody, "attributes"> = changedAttributes
      ? attributesPatchBody(
          specs,
          initialAttributes,
          attributes,
          variant.attributes,
          content.locales,
        )
      : {};
    const body = variantPatchBody(variant, values, attributeBody);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.updateVariant(product.id, variant.id, body),
    );
    if (outcome.kind === "ok") {
      setInitial(values);
      setInitialAttributes(attributes);
      onChanged("saved", { variantId: variant.id });
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <VariantEditorView
        t={t}
        uiLocale={locale}
        content={content}
        variant={variant}
        values={values}
        onChange={setValues}
        specs={specs}
        attributes={attributes}
        onAttributesChange={setAttributes}
        mode={mode}
        issues={issues}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        onSubmit={(event) => void submit(event)}
        onCancel={() => {
          setValues(initial);
          setAttributes(initialAttributes);
          onCancel();
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/** The create form of a draft product's variant, with its own unsaved-changes guard and dirty report. */
function VariantCreator({
  product,
  requiresShipping,
  naming,
  onChanged,
  onDirtyChange,
  onCancel,
}: {
  product: AdminProduct;
  requiresShipping: boolean;
  naming: VariantNaming;
  onChanged: ProductTabProps["onChanged"];
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const initial = useMemo(
    () => newVariantValues(product, requiresShipping),
    [product, requiresShipping],
  );
  const [values, setValues] = useState<VariantCreateValues>(initial);
  const form = useFormSubmit([
    "sku",
    "barcode",
    "optionValueIds",
    ...product.options.map((option) => `optionValueIds.${option.optionId}`),
  ]);
  const dirty = !jsonEqual(values, initial) && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const local = validateVariantCreate(values, product);
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createVariant(product.id, variantCreateBody(values, product)),
    );
    if (outcome.kind === "ok") {
      setValues(initial);
      onChanged("created", { values: { sku: outcome.data.sku } });
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <VariantCreateView
        t={t}
        naming={naming}
        product={product}
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        onSubmit={(event) => void submit(event)}
        onCancel={onCancel}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/**
 * Variants: the table, "generate the missing variants" (`POST .../variants/generate`, idempotent), a new variant by hand
 * on a draft, and per row edit (PATCH of the changed fields), make default, switch on or off, delete (draft only; the
 * rules are explained). Every write is sent once, never optimistic; the editor reloads the product afterwards. Prices and
 * stock are step 7's tabs.
 */
export function VariantsTab({
  product,
  productType,
  content,
  problems,
  onChanged,
  onDirtyChange,
}: ProductTabProps) {
  const { t, locale } = useI18n();
  const crash = useCrash();
  const canUpdate = useCan("updateVariant");
  const canDelete = useCan("deleteVariant");
  const canGenerate = useCan("generateVariants");
  const canCreate = useCan("createVariant");
  const specs = useMemo(() => attributeFieldSpecs(productType, "variant"), [productType]);
  const definitions = useOptionDefinitions(product.options.map((option) => option.optionId));
  const naming: VariantNaming = { uiLocale: locale, content, options: definitions.byId };
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminVariant | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageDescriptor | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();
  const known = new Set(product.variants.map((variant) => variant.id));
  const orphans = problems.filter(
    (problem) =>
      problem.tab === "variants" &&
      (problem.variantId === undefined || !known.has(problem.variantId)),
  );
  const editingVariant = product.variants.find((variant) => variant.id === editing) ?? null;
  const requiredVariantAttributes = specs.some((spec) => spec.isRequired);

  async function write<T>(call: () => Promise<AdminResult<T>>, onOk: (data: T) => void) {
    setBusy(true);
    setFailure(null);
    let outcome;
    try {
      outcome = await runWrite(call);
    } catch (bug) {
      crash(bug);
      return;
    }
    setBusy(false);
    if (outcome.kind === "ok") onOk(outcome.data);
    else if (outcome.kind === "unknown") onChanged("unknown");
    else if (outcome.kind === "problem") {
      setFailure(describeProblem(outcome.status, outcome.problem));
      focusAfterCommit(failureRef);
    }
  }

  const actions: VariantRowActions = {
    canEdit: canUpdate,
    canDelete,
    busy: busy || editing !== null || creating,
    onEdit: (variant) => {
      setCreating(false);
      setEditing(variant.id);
    },
    onMakeDefault: (variant) =>
      void write(
        () => adminClient.updateVariant(product.id, variant.id, { isDefault: true }),
        () => onChanged("saved", { variantId: variant.id }),
      ),
    onToggleActive: (variant, next) =>
      void write(
        () => adminClient.updateVariant(product.id, variant.id, { isActive: next }),
        () => onChanged("saved", { variantId: variant.id }),
      ),
    onDelete: (variant) => setDeleting(variant),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>
          {t(
            productType.requiresShipping
              ? "products.variants.introShipping"
              : "products.variants.introNoShipping",
          )}
        </p>
        <p>{t("products.variants.pricesElsewhere")}</p>
        {product.status !== "draft" && requiredVariantAttributes ? (
          <p>{t("products.variants.generatedInactive")}</p>
        ) : null}
      </div>
      <TabProblemsView t={t} id={VARIANTS_FOCUS_ID} problems={orphans} />
      {failure === null ? null : (
        <div ref={failureRef} tabIndex={-1}>
          <FailureMessage t={t} descriptor={failure} />
        </div>
      )}
      {(canGenerate || (canCreate && product.status === "draft")) &&
      editing === null &&
      !creating ? (
        <div className="flex flex-wrap gap-3">
          {canGenerate ? (
            <Button
              variant="secondary"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() =>
                void write(
                  () => adminClient.generateVariants(product.id),
                  (result) =>
                    onChanged("generated", {
                      values: { created: result.created, skipped: result.skipped },
                    }),
                )
              }
            >
              {t("products.variants.generate")}
            </Button>
          ) : null}
          {canCreate && product.status === "draft" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setCreating(true)}>
              {t("products.variants.add")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {canGenerate ? (
        <p className="text-sm text-muted-foreground">{t("products.variants.generateHint")}</p>
      ) : null}
      {definitions.status === "failed" ? (
        <FailureMessage
          t={t}
          descriptor={{ key: "products.options.namesFailed" }}
          onRetry={definitions.retry}
        />
      ) : null}
      <VariantsTableView
        t={t}
        naming={naming}
        product={product}
        specs={specs}
        problems={problems}
        actions={actions}
      />
      {editingVariant === null || !canUpdate ? null : (
        <VariantEditor
          key={editingVariant.id}
          variant={editingVariant}
          product={product}
          specs={specs}
          content={content}
          problems={problems}
          onChanged={onChanged}
          onDirtyChange={onDirtyChange}
          onCancel={() => setEditing(null)}
        />
      )}
      {creating && canCreate && product.status === "draft" ? (
        <VariantCreator
          product={product}
          requiresShipping={productType.requiresShipping}
          naming={naming}
          onChanged={onChanged}
          onDirtyChange={onDirtyChange}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      {deleting === null ? null : (
        <ConfirmDelete
          t={t}
          canWrite={canDelete}
          open
          onClose={() => setDeleting(null)}
          remove={() => adminClient.deleteVariant(product.id, deleting.id)}
          onDeleted={() => {
            setDeleting(null);
            onChanged("deleted", { values: { sku: deleting.sku } });
          }}
          onUnknown={() => {
            setDeleting(null);
            onChanged("unknown");
          }}
          title={t("products.variants.deleteTitle", { sku: deleting.sku })}
          description={t("products.variants.deleteBody")}
          hint={t("products.variants.deleteHint")}
          confirmLabel={t("products.variants.delete")}
        />
      )}
    </div>
  );
}
