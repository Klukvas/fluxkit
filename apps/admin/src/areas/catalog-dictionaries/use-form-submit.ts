import type { AdminResult } from "@fluxkit/api-client";
import { useCallback, useRef, useState, type RefObject } from "react";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { useCrash } from "../../lib/use-crash";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { FormIssues } from "./form-rules";
import { formErrorsFromProblem, summaryOf } from "./submit-errors";

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

const idle: SubmitState = {
  busy: false,
  fieldErrors: {},
  summary: [],
  unknown: false,
  status: null,
};

export interface FormSubmit {
  state: SubmitState;
  summaryRef: RefObject<HTMLDivElement | null>;
  /** Shows local issues (and moves the focus to the summary). Nothing is sent. */
  showIssues: (issues: FormIssues) => void;
  /** Runs one write once; the outcome says what the screen does next. Never repeats the write. */
  submit: <T>(write: () => Promise<AdminResult<T>>) => Promise<WriteOutcome<T>>;
  clear: () => void;
}

/**
 * The state of one form's writes (plan, "Forms and validation", "Writes"): busy while a request runs, the server's field
 * errors on the fields and in a focused summary, and the "result unknown" state for a lost answer. It never retries and
 * never updates anything before the server answered.
 */
export function useFormSubmit(formFields: readonly string[]): FormSubmit {
  const [state, setState] = useState<SubmitState>(idle);
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef(formFields);
  fieldsRef.current = formFields;
  const crash = useCrash();

  const show = useCallback(
    (fieldErrors: FormIssues, other: MessageDescriptor[], status: number | null) => {
      setState({
        busy: false,
        fieldErrors,
        summary: summaryOf(fieldErrors, other),
        unknown: false,
        status,
      });
      requestAnimationFrame(() => summaryRef.current?.focus());
    },
    [],
  );

  const showIssues = useCallback((issues: FormIssues) => show(issues, [], null), [show]);

  const submit = useCallback(
    async <T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T>> => {
      setState({ ...idle, busy: true });
      let outcome: WriteOutcome<T>;
      try {
        outcome = await runWrite(write);
      } catch (bug) {
        crash(bug);
        return { kind: "aborted" };
      }
      if (outcome.kind === "problem") {
        const mapped = formErrorsFromProblem(outcome.problem, outcome.status, fieldsRef.current);
        show(mapped.fields, mapped.other, outcome.status);
      } else if (outcome.kind === "unknown") {
        setState({ ...idle, unknown: true });
      } else {
        setState(idle);
      }
      return outcome;
    },
    [crash, show],
  );

  const clear = useCallback(() => setState(idle), []);
  return { state, summaryRef, showIssues, submit, clear };
}
