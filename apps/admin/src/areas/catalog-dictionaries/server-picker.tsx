import type { AdminResult, Paginated } from "@fluxkit/api-client";
import { Button, Field, Select, type Translator } from "@fluxkit/ui";
import { useEffect, useReducer, useRef, useState } from "react";
import { failureFromError } from "../../lib/failure";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { useCrash } from "../../lib/use-crash";
import { describe } from "./form-parts";
import {
  PICKER_PAGE_SIZE,
  canLoadMore,
  initialPickerState,
  nextOffset,
  pickerReducer,
  type PickerState,
} from "./picker-model";

type PageResult<T> =
  { kind: "page"; data: Paginated<T> } | { kind: "failed" } | { kind: "aborted" };

export interface ServerPickerProps<T> {
  t: Translator;
  id: string;
  name: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  /** One page of the server list; the picker asks for 100 at a time and never filters a page in the browser. */
  fetchPage: (
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<AdminResult<Paginated<T>>>;
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  /** An item that cannot be chosen (already assigned); it stays in the list, marked, so the list is the server's. */
  disabledReason?: (item: T) => string | null;
  /** Adds a first choice with an empty value, for example "Root level". */
  emptyChoiceLabel?: string;
  required?: boolean;
  error?: MessageDescriptor;
  disabled?: boolean;
}

/** `PickerState` that is already shown, for the presentational part and its tests. */
export function ServerPickerView<T>({
  t,
  id,
  name,
  label,
  hint,
  value,
  onChange,
  state,
  keyOf,
  labelOf,
  disabledReason,
  emptyChoiceLabel,
  required,
  error,
  disabled,
  onLoadMore,
  onRetry,
}: Omit<ServerPickerProps<T>, "fetchPage"> & {
  state: PickerState<T>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field
        id={id}
        label={label}
        hint={hint}
        error={error === undefined ? undefined : describe(t, error)}
        required={required}
        requiredIndicator={t("dict.form.requiredMark")}
      >
        {(control) => (
          <Select
            {...control}
            name={name}
            value={value}
            disabled={disabled === true || state.status !== "ready"}
            aria-busy={state.status === "loading" || undefined}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">
              {state.status === "loading"
                ? t("status.loading")
                : (emptyChoiceLabel ?? t("dict.picker.choose"))}
            </option>
            {state.items.map((item) => {
              const reason = disabledReason?.(item) ?? null;
              return (
                <option key={keyOf(item)} value={keyOf(item)} disabled={reason !== null}>
                  {reason === null ? labelOf(item) : `${labelOf(item)} (${reason})`}
                </option>
              );
            })}
          </Select>
        )}
      </Field>
      {state.status === "error" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-danger">{t("dict.picker.failed")}</p>
          <Button variant="secondary" onClick={onRetry}>
            {t("action.retry")}
          </Button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <p className="text-sm text-muted-foreground">
          {t("dict.picker.loaded", { loaded: state.items.length, total: state.total })}
        </p>
      ) : null}
      {state.moreFailed ? <p className="text-danger">{t("dict.picker.moreFailed")}</p> : null}
      {canLoadMore(state) || state.loadingMore ? (
        <div>
          <Button
            variant="secondary"
            disabled={state.loadingMore}
            aria-busy={state.loadingMore || undefined}
            onClick={onLoadMore}
          >
            {state.loadingMore ? t("status.loading") : t("dict.picker.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A choice among the items of a server list (attributes, options, categories): the first 100 on mount, more on demand.
 * Reads only; a failed page shows a retry, nothing is retried by itself.
 */
export function ServerPicker<T>(props: ServerPickerProps<T>) {
  const { fetchPage, keyOf } = props;
  const [state, dispatch] = useReducer(
    (current: PickerState<T>, action: Parameters<typeof pickerReducer<T>>[1]) =>
      pickerReducer(current, action, keyOf),
    initialPickerState,
  );
  const [attempt, setAttempt] = useState(0);
  const crash = useCrash();
  const fetchRef = useRef(fetchPage);
  const stateRef = useRef(state);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    fetchRef.current = fetchPage;
    stateRef.current = state;
  });

  async function read(offset: number, signal: AbortSignal): Promise<PageResult<T>> {
    try {
      const result = await fetchRef.current(offset, PICKER_PAGE_SIZE, signal);
      return result.ok ? { kind: "page", data: result.data } : { kind: "failed" };
    } catch (error) {
      try {
        return failureFromError(error) === null ? { kind: "aborted" } : { kind: "failed" };
      } catch (bug) {
        crash(bug);
        return { kind: "aborted" };
      }
    }
  }

  useEffect(() => {
    const own = new AbortController();
    controller.current = own;
    dispatch({ type: "reset" });
    void read(0, own.signal).then((result) => {
      if (own.signal.aborted || result.kind === "aborted") return;
      if (result.kind === "page") {
        dispatch({ type: "loaded", items: result.data.items, total: result.data.total });
      } else dispatch({ type: "failed" });
    });
    return () => own.abort();
    // `read` only reads refs and stable functions; a new attempt is the retry button.
  }, [attempt]);

  function loadMore() {
    const own = controller.current;
    if (own === null) return;
    dispatch({ type: "moreRequested" });
    void read(nextOffset(stateRef.current), own.signal).then((result) => {
      if (own.signal.aborted || result.kind === "aborted") return;
      if (result.kind === "page") {
        dispatch({ type: "moreLoaded", items: result.data.items, total: result.data.total });
      } else dispatch({ type: "moreFailed" });
    });
  }

  return (
    <ServerPickerView
      {...props}
      state={state}
      onLoadMore={loadMore}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}
