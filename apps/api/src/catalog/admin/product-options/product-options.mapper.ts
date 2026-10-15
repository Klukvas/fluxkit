import type { ProductOptionChangeError, ProductOptionSelection } from "@fluxkit/core";
import { ruleViolation, validationFailed, type ProblemException } from "../../../common/problem.js";
import type { ProductOptionRow, ProductOptionValueRow } from "../products/products.repository.js";

/** A selection with the stored display positions, so the service can tell a reorder from "no change". */
export interface StoredSelection extends ProductOptionSelection {
  readonly position: number;
  readonly valuePositions: ReadonlyMap<string, number>;
}

/** `product_option` and `product_option_value` rows -> the shape core plans with. */
export function toStoredSelections(
  options: readonly ProductOptionRow[],
  values: readonly ProductOptionValueRow[],
): StoredSelection[] {
  return options.map((option) => {
    const own = values.filter((value) => value.optionId === option.optionId);
    return {
      optionId: option.optionId,
      valueIds: own.map((value) => value.optionValueId),
      position: option.position,
      valuePositions: new Map(own.map((value) => [value.optionValueId, value.position])),
    };
  });
}

/**
 * Core refusals -> a problem. `options_frozen` is a business rule (409 `rule_violation`); everything else is a
 * problem with the request (400). `locate` names the request field a core error belongs to.
 */
export function toOptionChangeProblem(
  errors: readonly ProductOptionChangeError[],
  locate: (error: ProductOptionChangeError) => string,
): ProblemException {
  if (errors.every((error) => error.reason === "options_frozen")) {
    return ruleViolation(
      "The options of a published product are frozen; only new values of the chosen options can be added.",
      "options_frozen",
    );
  }
  return validationFailed(
    errors.map((error) => ({
      path: locate(error),
      code: error.reason,
      ...(error.limit === undefined ? {} : { message: `limit ${error.limit}` }),
    })),
  );
}

/** Error locations for `PUT .../options`: `options.<i>` or `options.<i>.valueIds.<j>`. */
export function locateInPutBody(
  desired: readonly ProductOptionSelection[],
): (error: ProductOptionChangeError) => string {
  return (error) => {
    // A duplicate is reported at its last occurrence; the first one is the valid entry.
    const index = desired.map((selection) => selection.optionId).lastIndexOf(error.optionId ?? "");
    if (error.optionId === undefined || index < 0) {
      return "options";
    }
    const valueIndex =
      error.valueId === undefined
        ? -1
        : (desired[index]?.valueIds.lastIndexOf(error.valueId) ?? -1);
    return valueIndex < 0 ? `options.${index}` : `options.${index}.valueIds.${valueIndex}`;
  };
}
