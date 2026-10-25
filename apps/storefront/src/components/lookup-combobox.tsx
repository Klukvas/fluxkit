"use client";

import { Button, Field, Input, LiveRegion, type Translator } from "@fluxkit/ui";
import { useEffect, useReducer, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import {
  closedCombobox,
  comboboxKey,
  comboboxReducer,
  optionId,
  type ComboboxState,
} from "../lib/combobox-model";
import { failureText, type Failure } from "../lib/failure";
import type { LookupSource, LookupStatus } from "../lib/lookup-source";

/**
 * A combobox with a listbox popup (WAI-ARIA Authoring Practices): an editable text box that searches while the shopper
 * types, a list of options under it, `aria-activedescendant` for the highlighted option (the focus stays in the text box),
 * the keys of `lib/combobox-model.ts`, and a polite live region that announces the number of results, "nothing found" or the
 * failure. Used by the city and pickup point pickers of the delivery step.
 *
 * `LookupComboboxView` is the pure markup (what the tests render); `LookupCombobox` adds the state.
 */

export interface ComboboxOption {
  key: string;
  /** The whole text of the option, as the carrier sent it (number and address for a pickup point). */
  text: string;
}

export interface LookupComboboxViewProps {
  t: Translator;
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required: boolean;
  disabled?: boolean;
  /** What is in the text box. */
  text: string;
  combo: ComboboxState;
  options: readonly ComboboxOption[];
  status: LookupStatus;
  stale: boolean;
  /** All matches of the carrier, when the list shows only a page of them. */
  total: number;
  failure: Failure | null;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onOpen: () => void;
  onClose: () => void;
  onHighlight: (index: number) => void;
  onChoose: (index: number) => void;
  onRetry: () => void;
}

/** The sentence a screen reader hears when the results change; empty while nothing has happened yet. */
export function lookupAnnouncement(
  t: Translator,
  state: Pick<LookupComboboxViewProps, "status" | "options" | "stale" | "failure">,
): string {
  const stale = state.stale ? ` ${t("checkout.shipping.lookup.stale")}` : "";
  switch (state.status) {
    case "loading":
      return t("checkout.shipping.lookup.loading");
    case "error":
      return state.failure === null ? "" : failureText(t, state.failure);
    case "ready":
      return state.options.length === 0
        ? t("checkout.shipping.lookup.empty")
        : `${t.plural("checkout.shipping.lookup.results", state.options.length)}${stale}`;
    default:
      return "";
  }
}

export function LookupComboboxView(props: LookupComboboxViewProps) {
  const { t, id, options, combo, status } = props;
  const listId = `${id}-list`;
  const statusId = `${id}-status`;
  const showList = combo.open && options.length > 0;
  const activeId =
    showList && combo.activeIndex >= 0 && combo.activeIndex < options.length
      ? optionId(listId, combo.activeIndex)
      : undefined;
  const empty = status === "ready" && options.length === 0;
  const hasStatusText =
    status === "loading" ||
    status === "error" ||
    empty ||
    (status === "ready" && (props.stale || props.total > options.length));
  return (
    <Field
      id={id}
      label={props.label}
      required={props.required}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.error === undefined ? {} : { error: props.error })}
    >
      {(control) => (
        <div className="flex flex-col gap-1">
          <div className="relative">
            <Input
              {...control}
              name={props.name}
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              {...(activeId === undefined ? {} : { "aria-activedescendant": activeId })}
              {...(hasStatusText
                ? {
                    "aria-describedby": [control["aria-describedby"], statusId]
                      .filter(Boolean)
                      .join(" "),
                  }
                : {})}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={props.text}
              disabled={props.disabled === true}
              onChange={(event) => props.onTextChange(event.currentTarget.value)}
              onKeyDown={props.onKeyDown}
              onClick={props.onOpen}
              onBlur={props.onClose}
            />
            <ul
              id={listId}
              role="listbox"
              aria-label={props.label}
              hidden={!showList}
              className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-background py-1 shadow-card"
            >
              {options.map((option, index) => (
                <li
                  key={option.key}
                  id={optionId(listId, index)}
                  role="option"
                  aria-selected={combo.activeIndex === index}
                  // The text box keeps the focus: a press must not blur it (that would close the list before the click).
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => props.onHighlight(index)}
                  onClick={() => props.onChoose(index)}
                  className="cursor-pointer px-3 py-2 text-foreground aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  {option.text}
                </li>
              ))}
            </ul>
          </div>
          <div
            id={statusId}
            className="flex flex-col items-start gap-1 text-sm text-muted-foreground"
          >
            {status === "loading" ? <p>{t("checkout.shipping.lookup.loading")}</p> : null}
            {empty ? <p>{t("checkout.shipping.lookup.empty")}</p> : null}
            {status === "error" ? (
              <>
                <p className="text-danger">
                  {props.failure === null ? "" : failureText(t, props.failure)}
                </p>
                <p>{t("checkout.shipping.lookup.hintNeedsRetry")}</p>
                <Button variant="secondary" onClick={props.onRetry}>
                  {t("checkout.shipping.lookup.retry")}
                </Button>
              </>
            ) : null}
            {status === "ready" && props.stale ? (
              <p>{t("checkout.shipping.lookup.stale")}</p>
            ) : null}
            {status === "ready" && props.total > options.length ? (
              <p>
                {t("checkout.shipping.lookup.truncated", {
                  shown: options.length,
                  total: props.total,
                })}
              </p>
            ) : null}
          </div>
          <LiveRegion visuallyHidden>{lookupAnnouncement(t, props)}</LiveRegion>
        </div>
      )}
    </Field>
  );
}

export interface LookupComboboxProps<T> {
  t: Translator;
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required: boolean;
  disabled?: boolean;
  source: LookupSource<T>;
  toOption: (item: T) => ComboboxOption;
  /** The text of the committed choice, `null` for none. A new choice replaces what is in the box. */
  selectedText: string | null;
  onChoose: (item: T) => void;
  /** The shopper edited the text of a committed choice: it is not a choice any more. */
  onClear: () => void;
  /** List everything when the box opens (pickup points of a chosen city) instead of waiting for text. */
  listOnMount?: boolean;
}

export function LookupCombobox<T>(props: LookupComboboxProps<T>) {
  const { source, toOption, selectedText } = props;
  const lookup = useSyncExternalStore(source.subscribe, source.getState, source.getState);
  const [combo, dispatch] = useReducer(comboboxReducer, closedCombobox);
  const [text, setText] = useState(selectedText ?? "");
  const options = lookup.items.map(toOption);

  useEffect(() => {
    if (selectedText !== null) setText(selectedText);
  }, [selectedText]);

  useEffect(() => {
    if (props.listOnMount === true) source.setQuery("");
    return () => source.dispose();
  }, [source, props.listOnMount]);

  // New results: the highlight would point at another option.
  useEffect(() => {
    dispatch({ type: "optionsChanged" });
  }, [lookup.items]);

  useEffect(() => {
    if (combo.activeIndex < 0) return;
    document
      .getElementById(optionId(`${props.id}-list`, combo.activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [combo.activeIndex, props.id]);

  function choose(index: number): void {
    const item = lookup.items[index];
    if (item === undefined) return;
    setText(toOption(item).text);
    dispatch({ type: "close" });
    props.onChoose(item);
  }

  return (
    <LookupComboboxView
      t={props.t}
      id={props.id}
      name={props.name}
      label={props.label}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.error === undefined ? {} : { error: props.error })}
      required={props.required}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      text={text}
      combo={combo}
      options={options}
      status={lookup.status}
      stale={lookup.stale}
      total={lookup.total}
      failure={lookup.failure}
      onTextChange={(next) => {
        setText(next);
        if (selectedText !== null) props.onClear();
        source.setQuery(next);
        dispatch({ type: "typed" });
      }}
      onKeyDown={(event) => {
        const outcome = comboboxKey(combo, event.key, options.length);
        if (outcome.preventDefault) event.preventDefault();
        dispatch({ type: "key", key: event.key, count: options.length });
        if (outcome.select !== null) choose(outcome.select);
      }}
      onOpen={() => {
        if (options.length > 0 || lookup.status === "loading") dispatch({ type: "open" });
      }}
      onClose={() => dispatch({ type: "close" })}
      onHighlight={(index) => dispatch({ type: "highlight", index })}
      onChoose={choose}
      onRetry={() => source.retry()}
    />
  );
}
