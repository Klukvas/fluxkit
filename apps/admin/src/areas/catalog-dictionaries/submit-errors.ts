import type { ProblemDetails } from "@fluxkit/api-client";
import { fieldErrorsFromProblem, type FormErrors } from "../../lib/form-errors";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";

/**
 * A problem answer on a form's fields and summary. `400 validation_failed` puts each `errors[].path` on the field of that
 * name (`name.uk`, `validation.min_length`); a `409 conflict` that names one column (`field`: `code`, `slug`) goes on that
 * field; everything else is explained in the summary through the problem map (the API's English `detail` is never shown).
 */
export function formErrorsFromProblem(
  problem: ProblemDetails,
  status: number,
  formFields: readonly string[],
): FormErrors<string> {
  if (
    problem.code === "conflict" &&
    problem.field !== undefined &&
    formFields.includes(problem.field)
  ) {
    return { fields: { [problem.field]: describeProblem(status, problem) }, other: [] };
  }
  return fieldErrorsFromProblem(problem, formFields, status);
}

/** The summary list: one line asking to check the marked fields (when there are any), then the errors without a field. */
export function summaryOf(
  fields: Readonly<Partial<Record<string, MessageDescriptor>>>,
  other: readonly MessageDescriptor[],
): MessageDescriptor[] {
  return [...(Object.keys(fields).length > 0 ? [{ key: "dict.form.checkFields" }] : []), ...other];
}
