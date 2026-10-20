import type { AdminResult } from "@fluxkit/api-client";
import { useCallback, useRef, useState, type RefObject } from "react";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { useCrash } from "../../lib/use-crash";
import type { FormIssues } from "./form-rules";
import { IDLE_SUBMIT, stateAfterOutcome, stateWithIssues, type SubmitState } from "./submit-errors";

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
 * never updates anything before the server answered. The decisions are pure functions in `submit-errors.ts`.
 */
export function useFormSubmit(formFields: readonly string[]): FormSubmit {
  const [state, setState] = useState<SubmitState>(IDLE_SUBMIT);
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef(formFields);
  fieldsRef.current = formFields;
  const crash = useCrash();

  const focusSummary = useCallback(() => {
    requestAnimationFrame(() => summaryRef.current?.focus());
  }, []);

  const showIssues = useCallback(
    (issues: FormIssues) => {
      setState(stateWithIssues(issues));
      focusSummary();
    },
    [focusSummary],
  );

  const submit = useCallback(
    async <T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T>> => {
      setState({ ...IDLE_SUBMIT, busy: true });
      let outcome: WriteOutcome<T>;
      try {
        outcome = await runWrite(write);
      } catch (bug) {
        crash(bug);
        return { kind: "aborted" };
      }
      const next = stateAfterOutcome(outcome, fieldsRef.current);
      setState(next);
      if (next.summary.length > 0) focusSummary();
      return outcome;
    },
    [crash, focusSummary],
  );

  const clear = useCallback(() => setState(IDLE_SUBMIT), []);
  return { state, summaryRef, showIssues, submit, clear };
}
