import type {
  AdminConfig,
  AdminPrice,
  AdminProduct,
  AdminVariant,
  ProblemDetails,
} from "@fluxkit/api-client";
import {
  Button,
  DataTable,
  Field,
  Input,
  Select,
  StatusBadge,
  VisuallyHidden,
  type Translator,
} from "@fluxkit/ui";
import { useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { formatMoney } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money-input";
import type { MessageDescriptor } from "../../../lib/problem-messages";
import { useRefreshingResource } from "../../../lib/use-refreshing-resource";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { FailureMessage, ResourceFallback } from "../../../views/status-views";
import { useAdminConfig } from "../../catalog-dictionaries/config-gate";
import { ConfirmDelete } from "../../catalog-dictionaries/form-dialog";
import {
  FormErrorSummary,
  describe,
  type ContentLocales,
} from "../../catalog-dictionaries/form-parts";
import type { FormIssues } from "../../catalog-dictionaries/form-rules";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import { TabProblemsView } from "../editor-views";
import { PRICES_FOCUS_ID, priceFieldId } from "../field-ids";
import { priceProblemIssues, type PublishProblem } from "../publish-problems";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { optionValuesText, type VariantNaming } from "../tabs/variants-tab";
import { useSession } from "../../../session/session-context";
import { priceControls } from "../stock/stock-access";
import { useOptionDefinitions } from "../use-option-definitions";
import {
  addColumn,
  canRemoveColumn,
  cellKey,
  fieldName,
  gridFrom,
  planPriceSave,
  priceDeleteBlock,
  priceErrorsFromProblem,
  priceGridDirty,
  pricesRevision,
  removeColumn,
  setCell,
  type PriceField,
  type PriceGrid,
  type PriceGridContext,
} from "./price-grid";

/** The grid's context from the admin config and the product detail's variants. */
export function priceContext(config: AdminConfig, product: AdminProduct): PriceGridContext {
  return {
    shopCurrency: config.shopCurrency,
    currencies: config.supportedCurrencies,
    variantIds: product.variants.map((variant) => variant.id),
  };
}

function exponentIn(context: PriceGridContext, currency: string): number {
  const found = context.currencies.find((entry) => entry.code === currency);
  if (found === undefined) throw new RangeError(`Unknown currency ${currency}.`);
  return found.exponent;
}

/** One price to remove (the confirmation names it). */
export interface PriceRemoval {
  variant: AdminVariant;
  currency: string;
}

export interface PricesGridViewProps {
  t: Translator;
  uiLocale: string;
  naming: VariantNaming;
  product: AdminProduct;
  context: PriceGridContext;
  stored: readonly AdminPrice[];
  grid: PriceGrid;
  /** Field issues by the grid's field names: local checks, server errors, publish problems. */
  issues: FormIssues;
  canWrite: boolean;
  canDelete: boolean;
  dirty: boolean;
  busy: boolean;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  onCell: (variantId: string, currency: string, field: PriceField, text: string) => void;
  onAddColumn: (currency: string) => void;
  onRemoveColumn: (currency: string) => void;
  onRemovePrice: (removal: PriceRemoval) => void;
  onDiscard: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function PriceInput({
  t,
  id,
  name,
  label,
  context,
  value,
  error,
  readOnly,
  onChange,
}: {
  t: Translator;
  id: string;
  name: string;
  label: string;
  context: string;
  value: string;
  error: MessageDescriptor | undefined;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      id={id}
      label={
        <>
          {label}
          <VisuallyHidden>{context}</VisuallyHidden>
        </>
      }
      error={error === undefined ? undefined : describe(t, error)}
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          className="w-32"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * The prices of every variant (rows, in the product detail's order) in every shown currency (columns: the shop currency
 * first). A writer gets an amount and an optional compare-at input per cell, typed as decimal text (a dot, the currency's
 * decimals, no grouping); the stored price is shown formatted from its integer minor units, and a typed value that differs
 * from it is shown as it will be stored. A viewer sees the stored prices only. Remove is per stored price, confirmed.
 */
export function PricesGridView({
  t,
  uiLocale,
  naming,
  product,
  context,
  stored,
  grid,
  issues,
  canWrite,
  canDelete,
  dirty,
  busy,
  summary,
  summaryRef,
  onCell,
  onAddColumn,
  onRemoveColumn,
  onRemovePrice,
  onDiscard,
  onSubmit,
}: PricesGridViewProps) {
  const [adding, setAdding] = useState("");
  const storedByKey = new Map(
    stored.map((price) => [cellKey(price.variantId, price.currency), price]),
  );
  const addable = context.currencies.filter((entry) => !grid.columns.includes(entry.code));
  const money = (amount: number, currency: string) =>
    formatMoney({ amount, currency }, exponentIn(context, currency), uiLocale);

  function cell(variant: AdminVariant, currency: string) {
    const key = cellKey(variant.id, currency);
    const price = storedByKey.get(key);
    const text = grid.cells[key] ?? { amount: "", compareAt: "" };
    const where = t("products.prices.cellContext", { sku: variant.sku, currency });
    const parsed = parseMoneyInput(text.amount, exponentIn(context, currency));
    const changed = parsed.ok && (price === undefined || price.amount !== parsed.amount);
    const block = priceDeleteBlock(
      currency,
      context.shopCurrency,
      variant.isActive,
      product.status,
    );
    return (
      <div className="flex flex-col gap-2">
        {price === undefined ? (
          <p className="text-sm text-muted-foreground">{t("products.prices.noPrice")}</p>
        ) : (
          <p className="text-sm">
            {t("products.prices.stored", { price: money(price.amount, currency) })}
            {price.compareAtAmount === null ? null : (
              <span className="block text-muted-foreground">
                {t("products.prices.storedCompareAt", {
                  price: money(price.compareAtAmount, currency),
                })}
              </span>
            )}
          </p>
        )}
        {canWrite ? (
          <>
            <PriceInput
              t={t}
              id={priceFieldId(variant.id, currency, "amount")}
              name={fieldName(variant.id, currency, "amount")}
              label={t("products.prices.amount")}
              context={where}
              value={text.amount}
              error={issues[fieldName(variant.id, currency, "amount")]}
              readOnly={busy}
              onChange={(value) => onCell(variant.id, currency, "amount", value)}
            />
            <PriceInput
              t={t}
              id={priceFieldId(variant.id, currency, "compareAt")}
              name={fieldName(variant.id, currency, "compareAt")}
              label={t("products.prices.compareAt")}
              context={where}
              value={text.compareAt}
              error={issues[fieldName(variant.id, currency, "compareAt")]}
              readOnly={busy}
              onChange={(value) => onCell(variant.id, currency, "compareAt", value)}
            />
            {changed ? (
              <p className="text-sm text-muted-foreground">
                {t("products.prices.willBe", { price: money(parsed.amount, currency) })}
              </p>
            ) : null}
          </>
        ) : null}
        {canDelete && price !== undefined ? (
          block === null ? (
            <Button
              variant="danger"
              disabled={busy || dirty}
              aria-label={t("products.prices.removeLabel", { sku: variant.sku, currency })}
              onClick={() => onRemovePrice({ variant, currency })}
            >
              {t("products.prices.remove")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("products.prices.lastShopPrice")}</p>
          )
        ) : null}
      </div>
    );
  }

  const table = (
    <DataTable
      caption={t("products.prices.caption", { count: product.variants.length })}
      columns={[
        {
          id: "variant",
          header: t("products.prices.columnVariant"),
          cell: (variant: AdminVariant) => (
            <span className="flex flex-col gap-1">
              <span className="font-medium">{variant.sku}</span>
              {variant.optionValues.length === 0 ? null : (
                <span className="text-sm text-muted-foreground">
                  {optionValuesText(naming, variant)}
                </span>
              )}
              <StatusBadge
                tone={variant.isActive ? "success" : "neutral"}
                label={t(
                  variant.isActive ? "products.variants.active" : "products.variants.inactive",
                )}
              />
            </span>
          ),
        },
        ...grid.columns.map((currency) => {
          const exponent = exponentIn(context, currency);
          return {
            id: `currency-${currency}`,
            header: (
              <span className="flex flex-col gap-1">
                <span>
                  {currency === context.shopCurrency
                    ? t("products.prices.shopCurrencyColumn", { currency })
                    : currency}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {exponent === 0
                    ? t("products.prices.wholeUnits")
                    : t("products.prices.decimals", { exponent })}
                </span>
                {canWrite && canRemoveColumn(grid, currency, stored) ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-label={t("products.prices.hideColumnLabel", { currency })}
                    onClick={() => onRemoveColumn(currency)}
                  >
                    {t("products.prices.hideColumn")}
                  </Button>
                ) : null}
              </span>
            ),
            cell: (variant: AdminVariant) => cell(variant, currency),
          };
        }),
      ]}
      rows={product.variants}
      rowKey={(variant) => variant.id}
      rowHeaderColumnId="variant"
      emptyMessage={t("products.variants.none")}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>{t("products.prices.intro", { currency: context.shopCurrency })}</p>
        {canWrite ? <p>{t("products.prices.inputHint")}</p> : null}
        {canDelete && dirty ? <p>{t("products.prices.removeWhileDirty")}</p> : null}
      </div>
      {canWrite && addable.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field id="product-prices-add-currency" label={t("products.prices.addCurrency")}>
            {(control) => (
              <Select
                {...control}
                value={adding}
                disabled={busy}
                onChange={(event) => setAdding(event.target.value)}
              >
                <option value="">{t("products.prices.chooseCurrency")}</option>
                {addable.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="secondary"
            disabled={busy || adding === ""}
            onClick={() => {
              onAddColumn(adding);
              setAdding("");
            }}
          >
            {t("products.prices.addCurrencyButton")}
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
          {issues["items"] === undefined ? null : (
            <FailureMessage t={t} descriptor={issues["items"]} />
          )}
          {table}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? t("products.form.saving") : t("products.prices.save")}
            </Button>
            <Button variant="secondary" disabled={busy || !dirty} onClick={onDiscard}>
              {t("products.prices.discard")}
            </Button>
          </div>
        </form>
      ) : (
        table
      )}
    </div>
  );
}

/** Local reasons as messages of the products area. */
function issuesOf(reasons: Record<string, string>): FormIssues {
  const issues: FormIssues = {};
  for (const [name, reason] of Object.entries(reasons)) {
    issues[name] = { key: `products.prices.reason.${reason}` };
  }
  return issues;
}

/** The editable grid of one stored state (keyed by `pricesRevision`, so a landed write rebuilds it). */
function PricesEditor({
  product,
  content,
  stored,
  problems,
  onSaved,
  onUnknown,
  onDirtyChange,
}: {
  product: AdminProduct;
  content: ContentLocales;
  stored: readonly AdminPrice[];
  problems: readonly PublishProblem[];
  onSaved: (count: number) => void;
  onUnknown: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const config = useAdminConfig();
  const session = useSession();
  const controls = priceControls(session.state.me?.permissions ?? null);
  const canWrite = controls.write;
  const canDelete = controls.remove;
  const definitions = useOptionDefinitions(product.options.map((option) => option.optionId));
  const naming: VariantNaming = { uiLocale: locale, content, options: definitions.byId };
  const context = useMemo(() => priceContext(config, product), [config, product]);
  const initial = useMemo(() => gridFrom(stored, context), [stored, context]);
  const [grid, setGrid] = useState(initial);
  const [removal, setRemoval] = useState<PriceRemoval | null>(null);
  const sentKeys = useRef<readonly string[]>([]);
  const fieldNames = useMemo(
    () =>
      context.variantIds.flatMap((variantId) =>
        context.currencies.flatMap((entry) => [
          fieldName(variantId, entry.code, "amount"),
          fieldName(variantId, entry.code, "compareAt"),
        ]),
      ),
    [context],
  );
  const form = useFormSubmit(fieldNames, (problem: ProblemDetails, status: number) =>
    priceErrorsFromProblem(problem, status, sentKeys.current),
  );
  const dirty = priceGridDirty(grid, initial) && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);
  const issues = { ...priceProblemIssues(problems), ...form.state.fieldErrors };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const plan = planPriceSave(grid, stored, context);
    if (!plan.ok) {
      form.showIssues(issuesOf(plan.issues));
      return;
    }
    if (plan.items.length === 0) {
      form.clear();
      onSaved(0);
      return;
    }
    sentKeys.current = plan.items.map((entry) => entry.key);
    const outcome = await form.submit(() =>
      adminClient.putProductPrices(product.id, { items: plan.items.map((entry) => entry.item) }),
    );
    if (outcome.kind === "ok") onSaved(plan.items.length);
    else if (outcome.kind === "unknown") onUnknown();
  }

  const removedVariant = removal?.variant ?? null;
  return (
    <>
      <PricesGridView
        t={t}
        uiLocale={locale}
        naming={naming}
        product={product}
        context={context}
        stored={stored}
        grid={grid}
        issues={issues}
        canWrite={canWrite}
        canDelete={canDelete}
        dirty={dirty}
        busy={form.state.busy}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        onCell={(variantId, currency, field, text) =>
          setGrid((current) => setCell(current, variantId, currency, field, text))
        }
        onAddColumn={(currency) => setGrid((current) => addColumn(current, currency, context))}
        onRemoveColumn={(currency) => setGrid((current) => removeColumn(current, currency, stored))}
        onRemovePrice={setRemoval}
        onDiscard={() => {
          form.clear();
          setGrid(initial);
        }}
        onSubmit={(event) => void submit(event)}
      />
      {removal === null || removedVariant === null ? null : (
        <ConfirmDelete
          t={t}
          canWrite={canDelete}
          open
          onClose={() => setRemoval(null)}
          remove={() =>
            adminClient.deleteVariantPrice(product.id, removedVariant.id, removal.currency)
          }
          onDeleted={() => {
            setRemoval(null);
            onSaved(-1);
          }}
          onUnknown={() => {
            setRemoval(null);
            onUnknown();
          }}
          title={t("products.prices.removeTitle", {
            sku: removedVariant.sku,
            currency: removal.currency,
          })}
          description={t(
            removal.currency === config.shopCurrency
              ? "products.prices.removeShopBody"
              : "products.prices.removeBody",
          )}
          hint={t("products.prices.removeHint")}
          confirmLabel={t("products.prices.remove")}
        />
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/**
 * Prices: one product-level read (`GET /admin/products/{id}/prices`, every variant and currency), one bulk save of the new
 * and changed cells, a confirmed delete per price. Never optimistic: after a write the tab reloads the prices (and the
 * editor its product); a lost answer is "result unknown" and the reload shows what the server has. Viewer: read-only.
 */
export function PricesTab({
  product,
  content,
  problems,
  onChanged,
  onDirtyChange,
}: ProductTabProps) {
  const { t } = useI18n();
  const resource = useRefreshingResource(
    (signal) => adminClient.listProductPrices(product.id, { signal }),
    [product.id],
  );
  const orphans = problems.filter((problem) => problem.tab === "prices" && problem.field === null);
  const stored = resource.data?.items ?? null;
  return (
    <div className="flex flex-col gap-6" aria-busy={resource.refreshing || undefined}>
      <TabProblemsView t={t} id={PRICES_FOCUS_ID} problems={orphans} />
      {resource.fallback !== null || stored === null ? (
        resource.fallback === null ? null : (
          <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
        )
      ) : (
        <PricesEditor
          key={pricesRevision(stored)}
          product={product}
          content={content}
          stored={stored}
          problems={problems}
          onDirtyChange={onDirtyChange}
          onSaved={(count) => {
            if (count === 0) {
              onChanged("noChanges");
              return;
            }
            resource.reload();
            onChanged(count < 0 ? "priceRemoved" : "saved");
          }}
          onUnknown={() => {
            resource.reload();
            onChanged("unknown");
          }}
        />
      )}
    </div>
  );
}
