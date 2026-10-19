import type { ProblemDetails } from "@fluxkit/api-client";
import { describeFieldError, describeProblem, type MessageDescriptor } from "./problem-messages";

export interface FormErrors<Field extends string> {
  /** The first error of each field the form shows, by `errors[].path`. */
  fields: Partial<Record<Field, MessageDescriptor>>;
  /** Everything else, for the error summary: errors of paths the form has no field for, or the problem itself. */
  other: MessageDescriptor[];
}

/**
 * Maps a `400 validation_failed` (or any problem) onto a form (plan, "Forms and validation"): `errors[].path` to the field
 * of that name with the translated `errors[].code`; nothing is dropped, an error the form cannot place goes to the summary.
 */
export function fieldErrorsFromProblem<Field extends string>(
  problem: ProblemDetails,
  formFields: readonly Field[],
  status = problem.status,
): FormErrors<Field> {
  const fields: Partial<Record<Field, MessageDescriptor>> = {};
  const other: MessageDescriptor[] = [];
  if (problem.errors === undefined || problem.errors.length === 0) {
    return { fields, other: [describeProblem(status, problem)] };
  }
  for (const error of problem.errors) {
    const descriptor = describeFieldError(error.code);
    const field = formFields.find((name) => name === error.path);
    if (field === undefined) other.push(descriptor);
    else if (fields[field] === undefined) fields[field] = descriptor;
  }
  return { fields, other };
}
