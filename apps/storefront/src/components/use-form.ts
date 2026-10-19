import { useEffect, useRef, useState, type FormEvent } from "react";
import { clientFailure, focusAfterFailure, missingRequired, type Failure } from "../lib/failure";

/**
 * State of one form that submits to the store API: the values, the last failure, a pending flag, and where focus goes after
 * a failed submit. Double submit is refused twice over: the button is disabled while pending, and a second submit that
 * arrives before React has rendered the disabled button (a fast double click, Enter held down) is dropped by a ref.
 *
 * Values live in component state only: never in a URL, in browser storage or in a log.
 */
export function useForm<V extends Record<string, string>>(options: {
  initial: V;
  /** Field paths in the order they appear on the page: the first invalid one gets the focus. */
  fieldOrder: readonly string[];
  /** Element id of each field path, for the focus and the error summary links. */
  fieldIds: Readonly<Record<string, string>>;
}) {
  const { fieldOrder, fieldIds } = options;
  const [values, setValues] = useState<V>(options.initial);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure !== null) {
      focusAfterFailure(failure, fieldOrder, fieldIds, summaryRef.current, document);
    }
  }, [failure, fieldOrder, fieldIds]);

  function setValue(name: keyof V & string, value: string): void {
    setValues((current) => ({ ...current, [name]: value }));
  }

  /**
   * `run` returns the failure to show, or `null` on success. After a success the form stays "pending" when `leaves` is set
   * (the page navigates away, a second submit must not happen); otherwise it is ready for the next submit.
   */
  async function submit(
    event: FormEvent<HTMLFormElement>,
    config: {
      required: readonly (keyof V & string)[];
      leaves: boolean;
      run: (values: V) => Promise<Failure | null>;
    },
  ): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const missing = missingRequired(values, config.required);
    if (missing !== null) {
      setFailure(missing);
      return;
    }
    submitting.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await config.run(values);
      if (result !== null || !config.leaves) {
        submitting.current = false;
        setPending(false);
      }
      setFailure(result);
    } catch (error) {
      // The stores report every failure the shopper can act on as a value; a throw is a bug. Free the form, stay loud.
      submitting.current = false;
      setPending(false);
      setFailure(clientFailure("errors.generic"));
      throw error;
    }
  }

  return { values, setValue, setValues, failure, setFailure, pending, summaryRef, submit };
}
