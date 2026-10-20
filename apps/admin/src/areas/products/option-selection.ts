import type {
  AdminProductMedia,
  AdminProductOption,
  ProblemDetails,
  PutProductOptionsBody,
} from "@fluxkit/api-client";
import type { FormErrors } from "../../lib/form-errors";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import type { FormIssues } from "../catalog-dictionaries/form-rules";

/**
 * The Options tab's model (ADR 0006 sections 3 and 5, `docs/api/catalog.md` "Product options and variants"). A DRAFT
 * product replaces its whole option set with `PUT /admin/products/{id}/options`: only new values of options it already
 * uses keep the variants (the new combinations are added); a removed value, an added option or a removed option makes
 * the API delete every variant and generate them again (`planOptionChange` mirrors core's `planProductOptionChange`
 * and is compared with it in the spec). A published or archived product's options are frozen (`options_frozen`): it can
 * only gain values, one at a time (`POST .../options/{optionId}/values`). No option code is known here. Pure.
 */

/** Core's `CATALOG_LIMITS` (compared in the spec; core is not in the bundle). */
export const MAX_OPTIONS_PER_PRODUCT = 3;
export const MAX_VALUES_PER_OPTION = 30;
export const MAX_VARIANTS_PER_PRODUCT = 250;

export interface OptionChoice {
  optionId: string;
  valueIds: readonly string[];
}

/** The options a product uses with the values it chose. */
export type OptionSelection = readonly OptionChoice[];

/** The order a request lists options and values in: what is stored first (its stored order), then the type's order. */
export interface SelectionOrder {
  optionIds: readonly string[];
  valueIds: Readonly<Record<string, readonly string[]>>;
}

const byPosition = <T extends { position: number }>(left: T, right: T) =>
  left.position - right.position;

export function selectionFrom(options: readonly AdminProductOption[]): OptionSelection {
  return [...options].sort(byPosition).map((option) => ({
    optionId: option.optionId,
    valueIds: [...option.values].sort(byPosition).map((value) => value.optionValueId),
  }));
}

function appendMissing(first: readonly string[], rest: readonly string[]): string[] {
  return [...first, ...rest.filter((id) => !first.includes(id))];
}

/**
 * The request order: the product's options and values as stored, then the options the type allows by the type's
 * position and each option's other values by their position (`definitions`, already in that order).
 */
export function selectionOrder(
  stored: readonly AdminProductOption[],
  definitions: readonly { optionId: string; valueIds: readonly string[] }[],
): SelectionOrder {
  const current = selectionFrom(stored);
  const optionIds = appendMissing(
    current.map((choice) => choice.optionId),
    definitions.map((definition) => definition.optionId),
  );
  const valueIds: Record<string, readonly string[]> = {};
  for (const optionId of optionIds) {
    valueIds[optionId] = appendMissing(
      current.find((choice) => choice.optionId === optionId)?.valueIds ?? [],
      definitions.find((definition) => definition.optionId === optionId)?.valueIds ?? [],
    );
  }
  return { optionIds, valueIds };
}

/** Turns an option on (with no values yet, at the end) or off (with its values). */
export function setOptionUsed(
  selection: OptionSelection,
  optionId: string,
  used: boolean,
): OptionSelection {
  const has = selection.some((choice) => choice.optionId === optionId);
  if (has === used) return selection;
  return used
    ? [...selection, { optionId, valueIds: [] }]
    : selection.filter((choice) => choice.optionId !== optionId);
}

/** Chooses or drops one value; choosing a value of an unused option turns the option on. */
export function setValueChosen(
  selection: OptionSelection,
  optionId: string,
  valueId: string,
  chosen: boolean,
): OptionSelection {
  const withOption = chosen ? setOptionUsed(selection, optionId, true) : selection;
  const choice = withOption.find((entry) => entry.optionId === optionId);
  if (choice === undefined || choice.valueIds.includes(valueId) === chosen) return selection;
  return withOption.map((entry) =>
    entry.optionId === optionId
      ? {
          optionId,
          valueIds: chosen
            ? [...entry.valueIds, valueId]
            : entry.valueIds.filter((id) => id !== valueId),
        }
      : entry,
  );
}

function sortedBy(ids: readonly string[], order: readonly string[]): string[] {
  const rank = (id: string) => {
    const at = order.indexOf(id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  return [...ids].sort((left, right) => rank(left) - rank(right));
}

/** `PUT /admin/products/{id}/options`; the list order is the display order the API stores. */
export function selectionBody(
  selection: OptionSelection,
  order: SelectionOrder,
): PutProductOptionsBody {
  const optionIds = sortedBy(
    selection.map((choice) => choice.optionId),
    order.optionIds,
  );
  return {
    options: optionIds.map((optionId) => ({
      optionId,
      valueIds: sortedBy(
        selection.find((choice) => choice.optionId === optionId)?.valueIds ?? [],
        order.valueIds[optionId] ?? [],
      ),
    })),
  };
}

/** The variants the selection makes: the product of the value counts (one variant without options). */
export function variantCount(selection: OptionSelection): number {
  return selection.reduce((count, choice) => count * choice.valueIds.length, 1);
}

/** Core's option reasons that the shell's problem map does not list; messages in `products.optionReason.*`. */
export const OPTION_REASONS = [
  "empty_value_list",
  "too_many_values",
  "duplicate_option",
  "too_many_variants_total",
  "too_many_new_variants",
] as const;

export function optionReason(code: string): MessageDescriptor {
  return (OPTION_REASONS as readonly string[]).includes(code)
    ? { key: `products.optionReason.${code}` }
    : describeFieldError(code);
}

/**
 * Early feedback keyed `options` (the whole set) and `options.<optionId>` (one option): at most 3 options, each with 1 to
 * 30 values, at most 250 variants in all (core limits). The server checks again.
 */
export function validateSelection(selection: OptionSelection): FormIssues {
  const issues: FormIssues = {};
  if (selection.length > MAX_OPTIONS_PER_PRODUCT)
    issues["options"] = optionReason("too_many_options");
  for (const choice of selection) {
    if (choice.valueIds.length === 0)
      issues[`options.${choice.optionId}`] = optionReason("empty_value_list");
    else if (choice.valueIds.length > MAX_VALUES_PER_OPTION)
      issues[`options.${choice.optionId}`] = optionReason("too_many_values");
  }
  if (issues["options"] === undefined && variantCount(selection) > MAX_VARIANTS_PER_PRODUCT) {
    issues["options"] = optionReason("too_many_variants_total");
  }
  return issues;
}

export interface OptionChangePlan {
  addedOptionIds: string[];
  removedOptionIds: string[];
  addedValues: OptionChoice[];
  removedValues: OptionChoice[];
  hasChanges: boolean;
  /** The API deletes every variant and generates them again (their SKUs, attributes, flags and prices go). */
  rebuildsVariants: boolean;
}

/** What a replace changes, as core plans it for a draft (the service then rebuilds or only adds). */
export function planOptionChange(
  current: OptionSelection,
  desired: OptionSelection,
): OptionChangePlan {
  const before = new Map(current.map((choice) => [choice.optionId, choice.valueIds]));
  const after = new Map(desired.map((choice) => [choice.optionId, choice.valueIds]));
  const addedOptionIds = [...after.keys()].filter((id) => !before.has(id));
  const removedOptionIds = [...before.keys()].filter((id) => !after.has(id));
  const addedValues: OptionChoice[] = [];
  const removedValues: OptionChoice[] = [];
  for (const [optionId, valueIds] of after) {
    const added = valueIds.filter((id) => !(before.get(optionId) ?? []).includes(id));
    if (added.length > 0) addedValues.push({ optionId, valueIds: added });
  }
  for (const [optionId, valueIds] of before) {
    const removed = valueIds.filter((id) => !(after.get(optionId) ?? []).includes(id));
    if (removed.length > 0) removedValues.push({ optionId, valueIds: removed });
  }
  const rebuildsVariants =
    addedOptionIds.length > 0 || removedOptionIds.length > 0 || removedValues.length > 0;
  return {
    addedOptionIds,
    removedOptionIds,
    addedValues,
    removedValues,
    hasChanges: rebuildsVariants || addedValues.length > 0,
    rebuildsVariants,
  };
}

/** The indexes of the images linked to a value the change removes (the API refuses with `in_use` while they exist). */
export function mediaUsingRemovedValues(
  plan: OptionChangePlan,
  media: readonly Pick<AdminProductMedia, "optionId" | "optionValueId">[],
): number[] {
  const removed = new Set(
    plan.removedValues.flatMap((choice) => choice.valueIds.map((id) => `${choice.optionId}:${id}`)),
  );
  return media.flatMap((entry, index) =>
    entry.optionId !== null &&
    entry.optionValueId !== null &&
    removed.has(`${entry.optionId}:${entry.optionValueId}`)
      ? [index]
      : [],
  );
}

/** The values of an option (in the option's order) that the product has not chosen yet. */
export function addableValues(
  optionValueIds: readonly string[],
  chosen: readonly string[],
): string[] {
  return optionValueIds.filter((id) => !chosen.includes(id));
}

/**
 * A refused replace on the form: `400` errors at `options.<i>` and `options.<i>.valueIds.<j>` (indexes into the sent
 * body) go on that option's field `options.<optionId>`; everything else, and a refusal without field errors
 * (`options_frozen`, `has_stock_history`, `has_order_lines`, `in_use`), goes to the summary. Nothing is dropped.
 */
export function optionErrorsFromProblem(
  problem: ProblemDetails,
  body: PutProductOptionsBody,
): FormErrors<string> {
  const fields: Partial<Record<string, MessageDescriptor>> = {};
  const other: MessageDescriptor[] = [];
  if (problem.errors === undefined || problem.errors.length === 0) {
    return { fields, other: [describeProblem(problem.status, problem)] };
  }
  for (const error of problem.errors) {
    const match = /^options\.(\d+)(?:\.|$)/.exec(error.path);
    const optionId = match === null ? undefined : body.options[Number(match[1])]?.optionId;
    const descriptor = optionReason(error.code);
    if (optionId === undefined) other.push(descriptor);
    else fields[`options.${optionId}`] ??= descriptor;
  }
  return { fields, other };
}
