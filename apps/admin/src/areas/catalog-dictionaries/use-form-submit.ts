import type { AdminResult } from "@fluxkit/api-client";
import { useCallback, useRef, useState, type RefObject } from "react";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useCrash } from "../../lib/use-crash";
import type { FormIssues } from "./form-rules";
import {
  IDLE_SUBMIT,
  stateAfterOutcome,
  stateWithIssues,
  type ProblemMapper,
  type SubmitState,
} from "./submit-errors";

export interface FormSubmit {
  state: SubmitState;
  summaryRef: RefObject<HTMLDivElement | null>;
  /** Shows local issues (and moves the focus to the summary). Nothing is sent. */
  showIssues: (issues: FormIssues) => void;
  /**
   * Runs one write once; the outcome says what the screen does next. Never repeats the write. While a write of this form
   * runs, another submit sends nothing, leaves the state alone and answers `aborted` (nothing to act on).
   */
  submit: <T>(write: () => Promise<AdminResult<T>>) => Promise<WriteOutcome<T>>;
  clear: () => void;
}

export interface FormWriterParts {
  setState: (state: SubmitState) => void;
  crash: (bug: unknown) => void;
  focusSummary: () => void;
  /** Read at the answer, so the latest field list and mapper are used. */
  fields: () => readonly string[];
  mapProblem: () => ProblemMapper | undefined;
}

/**
 * The write half of `useFormSubmit` without React (tested on its own): one write at a time through a single flight, so
 * two submits in one task (before React renders the busy state: a script, an extension, a programmatic submit) send one
 * request (step 13 review, L1). The busy state is set synchronously, before the request leaves.
 */
export function createFormWriter(parts: FormWriterParts): Pick<FormSubmit, "submit"> {
  const flight = createSingleFlight();
  async function once<T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T>> {
    parts.setState({ ...IDLE_SUBMIT, busy: true });
    let outcome: WriteOutcome<T>;
    try {
      outcome = await runWrite(write);
    } catch (bug) {
      parts.crash(bug);
      return { kind: "aborted" };
    }
    const next = stateAfterOutcome(outcome, parts.fields(), parts.mapProblem());
    parts.setState(next);
    if (next.summary.length > 0) parts.focusSummary();
    return outcome;
  }
  return {
    submit<T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T>> {
      return flight.run(() => once(write)) ?? Promise.resolve({ kind: "aborted" });
    },
  };
}

/**
 * The state of one form's writes (plan, "Forms and validation", "Writes"): busy while a request runs, the server's field
 * errors on the fields and in a focused summary, and the "result unknown" state for a lost answer. It never retries,
 * never sends a second write while one runs, and never updates anything before the server answered. The decisions are
 * pure functions in `submit-errors.ts`.
 */
export function useFormSubmit(
  formFields: readonly string[],
  mapProblem?: ProblemMapper,
): FormSubmit {
  const [state, setState] = useState<SubmitState>(IDLE_SUBMIT);
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef(formFields);
  fieldsRef.current = formFields;
  const mapRef = useRef(mapProblem);
  mapRef.current = mapProblem;
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

  // One writer (and so one single flight) for the life of the form; `crash` and `focusSummary` are stable.
  const [writer] = useState(() =>
    createFormWriter({
      setState,
      crash,
      focusSummary,
      fields: () => fieldsRef.current,
      mapProblem: () => mapRef.current,
    }),
  );

  const clear = useCallback(() => setState(IDLE_SUBMIT), []);
  return { state, summaryRef, showIssues, submit: writer.submit, clear };
}
