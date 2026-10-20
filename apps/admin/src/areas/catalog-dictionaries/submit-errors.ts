import type { ProblemDetails } from "@fluxkit/api-client";
import type { WriteOutcome } from "../../lib/run-write";
import { fieldErrorsFromProblem, type FormErrors } from "../../lib/form-errors";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";
import type { FormIssues } from "./form-rules";

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

export interface SubmitState {
  /** A write is running: the buttons are disabled so it cannot be sent twice. */
  busy: boolean;
  /** By field name (the API's `errors[].path`). */
  fieldErrors: FormIssues;
  /** The error summary: it receives the focus when it appears. */
  summary: MessageDescriptor[];
  /** The last write got no answer: it may or may not have happened. */
  unknown: boolean;
  /** The status of the problem the API answered, `null` when there is none. */
  status: number | null;
}

export const IDLE_SUBMIT: SubmitState = {
  busy: false,
  fieldErrors: {},
  summary: [],
  unknown: false,
  status: null,
};

/** Local checks failed: nothing was sent. */
export function stateWithIssues(issues: FormIssues): SubmitState {
  return { ...IDLE_SUBMIT, fieldErrors: issues, summary: summaryOf(issues, []) };
}

/** What a form shows once its write ended. The write itself is run once by the caller and never repeated. */
export function stateAfterOutcome(
  outcome: WriteOutcome<unknown>,
  formFields: readonly string[],
): SubmitState {
  switch (outcome.kind) {
    case "problem": {
      const mapped = formErrorsFromProblem(outcome.problem, outcome.status, formFields);
      return {
        ...IDLE_SUBMIT,
        fieldErrors: mapped.fields,
        summary: summaryOf(mapped.fields, mapped.other),
        status: outcome.status,
      };
    }
    case "unknown":
      return { ...IDLE_SUBMIT, unknown: true };
    case "ok":
    case "aborted":
      return IDLE_SUBMIT;
  }
}
