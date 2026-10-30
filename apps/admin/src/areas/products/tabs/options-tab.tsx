import type {
  AdminOptionWithValues,
  AdminProduct,
  AdminProductTypeDetail,
} from "@fluxkit/api-client";
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Select,
  type Translator,
} from "@fluxkit/ui";
import { useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { describeProblem, type MessageDescriptor } from "../../../lib/problem-messages";
import { runWrite } from "../../../lib/run-write";
import { useCrash } from "../../../lib/use-crash";
import { useFocusAfterCommit } from "../../../lib/use-focus-after-commit";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { FailureMessage, LoadingView } from "../../../views/status-views";
import {
  FormActions,
  FormErrorSummary,
  describe,
  type ContentLocales,
} from "../../catalog-dictionaries/form-parts";
import { hasIssues, type FormIssues } from "../../catalog-dictionaries/form-rules";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import { TabProblemsView } from "../editor-views";
import { OPTIONS_FOCUS_ID, optionFocusId } from "../field-ids";
import {
  MAX_OPTIONS_PER_PRODUCT,
  MAX_VALUES_PER_OPTION,
  addableValues,
  mediaUsingRemovedValues,
  optionErrorsFromProblem,
  planOptionChange,
  selectionBody,
  selectionFrom,
  selectionOrder,
  setOptionUsed,
  setValueChosen,
  validateSelection,
  variantCount,
  type OptionChangePlan,
  type OptionSelection,
  type SelectionOrder,
} from "../option-selection";
import type { PublishProblem } from "../publish-problems";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { useCan } from "../use-can";
import {
  definitionValueIds,
  optionName,
  useOptionDefinitions,
  valueLabel,
  type OptionDefinitions,
} from "../use-option-definitions";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** What the option views need to name options and values. */
export interface OptionNaming {
  uiLocale: string;
  content: ContentLocales;
  byId: ReadonlyMap<string, AdminOptionWithValues>;
}

function nameOf(naming: OptionNaming, optionId: string, code: string): string {
  return optionName(naming.byId.get(optionId), code, naming.uiLocale, naming.content.defaultLocale);
}

function labelOf(naming: OptionNaming, optionId: string, valueId: string, code: string): string {
  return valueLabel(
    naming.byId.get(optionId),
    valueId,
    code,
    naming.uiLocale,
    naming.content.defaultLocale,
  );
}

/** One "add a value" control of a live product's option. */
export interface AddValueControl {
  /** The option's values the product has not chosen, with labels. */
  choices: readonly { id: string; label: string }[];
  chosen: string;
  onChoose: (valueId: string) => void;
  onAdd: () => void;
}

/**
 * The options the product uses, in order, with their chosen values; each option is a focus target of its publish
 * problems (`options.<code>`, for example an option the type no longer allows). On a published or archived product each
 * option offers "add a value" when the session may (`addValue`), since the option set itself is frozen.
 */
export function CurrentOptionsView({
  t,
  naming,
  product,
  problems,
  addValue,
  busy,
}: {
  t: Translator;
  naming: OptionNaming;
  product: AdminProduct;
  problems: readonly PublishProblem[];
  addValue?: (optionId: string) => AddValueControl | null;
  busy: boolean;
}) {
  const options = [...product.options].sort((left, right) => left.position - right.position);
  return (
    <section aria-labelledby="product-options-current" className="flex flex-col gap-4">
      <h2 id="product-options-current" className="text-lg font-semibold">
        {t("products.options.current")}
      </h2>
      {options.length === 0 ? (
        <p className="text-muted-foreground">{t("products.options.noneUsed")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {options.map((option) => {
            const own = problems.filter(
              (problem) => problem.field === `options.${option.optionCode}`,
            );
            const control = addValue?.(option.optionId) ?? null;
            const selectId = `product-option-${option.optionCode}-add`;
            return (
              <li
                key={option.optionId}
                id={optionFocusId(option.optionCode)}
                tabIndex={-1}
                className={`flex flex-col gap-2 rounded-md border border-border p-4 ${focusClass}`}
              >
                <h3 className="font-semibold">
                  {t("products.options.optionName", {
                    name: nameOf(naming, option.optionId, option.optionCode),
                    code: option.optionCode,
                  })}
                </h3>
                <p>
                  {[...option.values]
                    .sort((left, right) => left.position - right.position)
                    .map((value) =>
                      labelOf(naming, option.optionId, value.optionValueId, value.valueCode),
                    )
                    .join(", ")}
                </p>
                {own.map((problem, index) => (
                  <p key={`${problem.path}-${index}`} className="text-danger">
                    {describe(t, problem.message)}
                  </p>
                ))}
                {control === null ? null : control.choices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("products.options.allChosen")}</p>
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <Field id={selectId} label={t("products.options.addValueLabel")}>
                      {(field) => (
                        <Select
                          {...field}
                          value={control.chosen}
                          disabled={busy}
                          onChange={(event) => control.onChoose(event.target.value)}
                        >
                          <option value="">{t("products.options.chooseValue")}</option>
                          {control.choices.map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {choice.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={busy || control.chosen === ""}
                      onClick={control.onAdd}
                    >
                      {t("products.options.addValue")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** What a replace will do, in words: nothing, only new variants, or every variant deleted and generated again. */
export function ReplacePlanView({
  t,
  plan,
  variantsNow,
  variantsAfter,
}: {
  t: Translator;
  plan: OptionChangePlan;
  variantsNow: number;
  variantsAfter: number;
}) {
  if (!plan.hasChanges)
    return <p className="text-muted-foreground">{t("products.options.planNone")}</p>;
  if (!plan.rebuildsVariants) {
    return <p>{t("products.options.planAddOnly", { after: variantsAfter })}</p>;
  }
  return (
    <Alert variant="warning" title={t("products.options.planRebuildTitle")}>
      <p>{t("products.options.planRebuild", { now: variantsNow, after: variantsAfter })}</p>
    </Alert>
  );
}

/**
 * The draft product's option set as a form: every option the product type allows, with a checkbox to use it and one per
 * value (the stored ones first). Saving replaces the whole set (`PUT .../options`); the plan below says what happens to
 * the variants before anything is sent.
 */
export function ReplaceOptionsView({
  t,
  naming,
  productType,
  order,
  selection,
  onChange,
  issues,
  summary,
  summaryRef,
  plan,
  variantsNow,
  busy,
  onSubmit,
}: {
  t: Translator;
  naming: OptionNaming;
  productType: AdminProductTypeDetail;
  order: SelectionOrder;
  selection: OptionSelection;
  onChange: (next: OptionSelection) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  plan: OptionChangePlan;
  variantsNow: number;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const codeOf = (optionId: string) =>
    productType.options.find((entry) => entry.optionId === optionId)?.optionCode ??
    naming.byId.get(optionId)?.code ??
    optionId;
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("products.options.replaceTitle")}</h2>
      <p className="text-muted-foreground">
        {t("products.options.replaceIntro", {
          maxOptions: MAX_OPTIONS_PER_PRODUCT,
          maxValues: MAX_VALUES_PER_OPTION,
        })}
      </p>
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      {issues["options"] === undefined ? null : (
        <p className="text-danger">{describe(t, issues["options"])}</p>
      )}
      {order.optionIds.length === 0 ? (
        <p className="text-muted-foreground">{t("products.options.noneAllowed")}</p>
      ) : (
        order.optionIds.map((optionId) => {
          const code = codeOf(optionId);
          const choice = selection.find((entry) => entry.optionId === optionId);
          const allowed = productType.options.some((entry) => entry.optionId === optionId);
          const error = issues[`options.${optionId}`];
          const errorId = `product-option-edit-${code}-error`;
          return (
            <fieldset
              key={optionId}
              className="flex flex-col gap-2 rounded-md border border-border p-4"
              aria-describedby={error === undefined ? undefined : errorId}
            >
              <legend className="px-1 font-medium">
                {t("products.options.optionName", { name: nameOf(naming, optionId, code), code })}
              </legend>
              {allowed ? null : (
                <p className="text-sm text-danger">{t("products.options.notAllowed")}</p>
              )}
              <Checkbox
                id={`product-option-edit-${code}`}
                label={t("products.options.use")}
                checked={choice !== undefined}
                disabled={busy}
                onChange={(event) =>
                  onChange(setOptionUsed(selection, optionId, event.target.checked))
                }
              />
              <div className="flex flex-wrap gap-x-6 ps-6">
                {(order.valueIds[optionId] ?? []).map((valueId) => (
                  <Checkbox
                    key={valueId}
                    id={`product-option-edit-${code}-${valueId}`}
                    label={labelOf(naming, optionId, valueId, valueId)}
                    checked={choice?.valueIds.includes(valueId) ?? false}
                    disabled={busy}
                    onChange={(event) =>
                      onChange(setValueChosen(selection, optionId, valueId, event.target.checked))
                    }
                  />
                ))}
              </div>
              {error === undefined ? null : (
                <p id={errorId} className="text-sm text-danger">
                  {describe(t, error)}
                </p>
              )}
            </fieldset>
          );
        })
      )}
      <ReplacePlanView
        t={t}
        plan={plan}
        variantsNow={variantsNow}
        variantsAfter={variantCount(selection)}
      />
      <FormActions
        t={t}
        busy={busy}
        submitLabel={t("products.options.replace")}
        busyLabel={t("products.form.saving")}
      />
    </form>
  );
}

/** The labels of the values the product could add to an option, in the option's order. */
function addChoices(
  naming: OptionNaming,
  optionId: string,
  chosen: readonly string[],
): { id: string; label: string }[] {
  const definition = naming.byId.get(optionId);
  return addableValues(definitionValueIds(definition), chosen).map((id) => ({
    id,
    label: labelOf(naming, optionId, id, id),
  }));
}

function DefinitionsState({ t, definitions }: { t: Translator; definitions: OptionDefinitions }) {
  if (definitions.status === "loading") return <LoadingView t={t} />;
  if (definitions.status === "failed") {
    return (
      <FailureMessage
        t={t}
        descriptor={{ key: "products.options.namesFailed" }}
        onRetry={definitions.retry}
      />
    );
  }
  return null;
}

/** A live product: add one value to an option (confirmed: it cannot be removed while the product is not a draft). */
function AddValueSection({
  product,
  naming,
  definitions,
  problems,
  onChanged,
}: Pick<ProductTabProps, "product" | "problems" | "onChanged"> & {
  naming: OptionNaming;
  definitions: OptionDefinitions;
}) {
  const { t } = useI18n();
  const crash = useCrash();
  const canAdd = useCan("addProductOptionValue");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ optionId: string; valueId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageDescriptor | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();

  async function add(target: { optionId: string; valueId: string }) {
    setBusy(true);
    setFailure(null);
    let outcome;
    try {
      outcome = await runWrite(() =>
        adminClient.addProductOptionValue(product.id, target.optionId, { valueId: target.valueId }),
      );
    } catch (bug) {
      crash(bug);
      return;
    }
    setBusy(false);
    setConfirming(null);
    if (outcome.kind === "ok") onChanged("valueAdded");
    else if (outcome.kind === "unknown") onChanged("unknown");
    else if (outcome.kind === "problem") {
      setFailure(describeProblem(outcome.status, outcome.problem));
      focusAfterCommit(failureRef);
    }
  }

  const ready = definitions.status === "ready";
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="warning" title={t("products.options.frozenTitle")}>
        <p>{t("products.options.frozenBody")}</p>
      </Alert>
      {failure === null ? null : (
        <div ref={failureRef} tabIndex={-1}>
          <FailureMessage t={t} descriptor={failure} />
        </div>
      )}
      <CurrentOptionsView
        t={t}
        naming={naming}
        product={product}
        problems={problems}
        busy={busy}
        addValue={
          canAdd && ready
            ? (optionId) => {
                const option = product.options.find((entry) => entry.optionId === optionId);
                return {
                  choices: addChoices(
                    naming,
                    optionId,
                    option?.values.map((value) => value.optionValueId) ?? [],
                  ),
                  chosen: chosen[optionId] ?? "",
                  onChoose: (valueId) => setChosen({ ...chosen, [optionId]: valueId }),
                  onAdd: () => setConfirming({ optionId, valueId: chosen[optionId] ?? "" }),
                };
              }
            : undefined
        }
      />
      {canAdd ? <DefinitionsState t={t} definitions={definitions} /> : null}
      {confirming === null ? null : (
        <ConfirmDialog
          open
          busy={busy}
          title={t("products.options.addValueTitle", {
            value: labelOf(naming, confirming.optionId, confirming.valueId, confirming.valueId),
          })}
          description={t("products.options.addValueBody")}
          confirmLabel={t("products.options.addValue")}
          cancelLabel={t("dict.form.cancel")}
          onClose={() => setConfirming(null)}
          onConfirm={() => void add(confirming)}
        />
      )}
    </div>
  );
}

/** A draft product: the current options, and the replace form (confirmed when the variants are rebuilt). */
function ReplaceSection({
  product,
  productType,
  naming,
  definitions,
  problems,
  onChanged,
  onDirtyChange,
}: Pick<ProductTabProps, "product" | "productType" | "problems" | "onChanged" | "onDirtyChange"> & {
  naming: OptionNaming;
  definitions: OptionDefinitions;
}) {
  const { t } = useI18n();
  const canReplace = useCan("putProductOptions");
  const initial = useMemo(() => selectionFrom(product.options), [product.options]);
  const [selection, setSelection] = useState<OptionSelection>(initial);
  const [confirming, setConfirming] = useState(false);
  const order = useMemo(
    () =>
      selectionOrder(
        product.options,
        [...productType.options]
          .sort((left, right) => left.position - right.position)
          .map((entry) => ({
            optionId: entry.optionId,
            valueIds: definitionValueIds(naming.byId.get(entry.optionId)),
          })),
      ),
    [product.options, productType.options, naming.byId],
  );
  const body = selectionBody(selection, order);
  const plan = planOptionChange(initial, selection);
  const form = useFormSubmit(
    ["options", ...order.optionIds.map((id) => `options.${id}`)],
    (problem) => optionErrorsFromProblem(problem, body),
  );
  const dirty = plan.hasChanges && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);

  async function save() {
    setConfirming(false);
    const outcome = await form.submit(() => adminClient.putProductOptions(product.id, body));
    if (outcome.kind === "ok") onChanged("saved");
    else if (outcome.kind === "unknown") onChanged("unknown");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canReplace) return;
    const local: FormIssues = validateSelection(selection);
    const linked = mediaUsingRemovedValues(plan, product.media);
    if (linked.length > 0) {
      local["options"] = {
        key: "products.options.mediaLinked",
        values: { images: linked.map((index) => index + 1).join(", ") },
      };
    }
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    if (!plan.hasChanges) {
      onChanged("noChanges");
      return;
    }
    if (plan.rebuildsVariants && product.variants.length > 0) setConfirming(true);
    else void save();
  }

  return (
    <div className="flex flex-col gap-8">
      <CurrentOptionsView
        t={t}
        naming={naming}
        product={product}
        problems={problems}
        busy={false}
      />
      {canReplace ? (
        definitions.status === "ready" ? (
          <ReplaceOptionsView
            t={t}
            naming={naming}
            productType={productType}
            order={order}
            selection={selection}
            onChange={setSelection}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            plan={plan}
            variantsNow={product.variants.length}
            busy={form.state.busy}
            onSubmit={submit}
          />
        ) : (
          <DefinitionsState t={t} definitions={definitions} />
        )
      ) : null}
      {confirming ? (
        <ConfirmDialog
          open
          tone="danger"
          busy={form.state.busy}
          title={t("products.options.replaceConfirmTitle")}
          description={t("products.options.replaceConfirmBody", {
            now: product.variants.length,
            after: variantCount(selection),
          })}
          confirmLabel={t("products.options.replace")}
          cancelLabel={t("dict.form.cancel")}
          onClose={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

/**
 * Options: the options the product uses and their values. A draft replaces its whole set (variants are kept when only
 * values are added, otherwise all are deleted and generated again; confirmed). A published or archived product's options
 * are frozen (`options_frozen`): it can only gain values, one at a time. The names come from the options themselves
 * (codes until they are loaded); no option is known to this code.
 */
export function OptionsTab(props: ProductTabProps) {
  const { t, locale } = useI18n();
  const { product, productType, content } = props;
  const definitions = useOptionDefinitions([
    ...productType.options.map((entry) => entry.optionId),
    ...product.options.map((entry) => entry.optionId),
  ]);
  const naming: OptionNaming = { uiLocale: locale, content, byId: definitions.byId };
  const own = props.problems.filter((problem) => problem.tab === "options");
  return (
    <div className="flex flex-col gap-6">
      <TabProblemsView t={t} id={OPTIONS_FOCUS_ID} problems={own} />
      {product.status === "draft" ? (
        <ReplaceSection {...props} problems={own} naming={naming} definitions={definitions} />
      ) : (
        <AddValueSection
          product={product}
          problems={own}
          onChanged={props.onChanged}
          naming={naming}
          definitions={definitions}
        />
      )}
    </div>
  );
}
