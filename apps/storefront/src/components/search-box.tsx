"use client";

import { Button, Input, LiveRegion, type Locale, type Translator } from "@fluxkit/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useId,
  useReducer,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  closedCombobox,
  comboboxReducer,
  optionId,
  type ComboboxState,
} from "../lib/combobox-model";
import { failureText, type Failure } from "../lib/failure";
import type { LookupStatus } from "../lib/lookup-source";
import {
  createSuggestSource,
  suggestKey,
  suggestionHref,
  type Suggestion,
} from "../lib/suggest-source";
import { useI18n } from "./i18n-provider";
import { useStoreClient } from "./session-provider";

/**
 * The search box of the header (plan 2026-10-29-search.md, section 9), rendered only when the shop has search. It is a form
 * first: `GET /{locale}/search?q=` works before the script has loaded and without it. With the script it is the WAI-ARIA
 * combobox with a listbox popup (the focus stays in the text box, `aria-activedescendant` names the highlighted
 * suggestion, a polite live region announces the count) over `GET /store/search/suggest`: after 2 characters and 200 ms,
 * one request at a time (the older one aborted), through the typed client on the page's own origin.
 *
 * Enter opens the highlighted suggestion; with none highlighted it submits the search (the pickers of the delivery step
 * differ here). The popup holds the suggestions and the status text, positioned over the page, so it shifts nothing.
 *
 * `SearchBoxView` is the pure markup (what the tests render); `SearchBox` adds the state.
 */

export interface SearchBoxViewProps {
  t: Translator;
  locale: Locale;
  id: string;
  text: string;
  combo: ComboboxState;
  options: readonly Suggestion[];
  status: LookupStatus;
  failure: Failure | null;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onHighlight: (index: number) => void;
  onChoose: (index: number) => void;
  onSubmit: () => void;
}

/** The sentence a screen reader hears when the suggestions change; empty while nothing has happened. */
export function searchBoxAnnouncement(
  t: Translator,
  state: Pick<SearchBoxViewProps, "status" | "options" | "failure">,
): string {
  switch (state.status) {
    case "loading":
      return t("searchBox.loading");
    case "error":
      return state.failure === null ? "" : failureText(t, state.failure);
    case "ready":
      return state.options.length === 0
        ? t("searchBox.empty")
        : t.plural("searchBox.results", state.options.length);
    default:
      return "";
  }
}

export function SearchBoxView(props: SearchBoxViewProps) {
  const { t, locale, id, options, combo, status } = props;
  const listId = `${id}-list`;
  const showList = combo.open && status === "ready" && options.length > 0;
  const activeId =
    showList && combo.activeIndex >= 0 && combo.activeIndex < options.length
      ? optionId(listId, combo.activeIndex)
      : undefined;
  const showStatus =
    combo.open &&
    (status === "loading" || status === "error" || (status === "ready" && options.length === 0));
  return (
    // GET and an action: the one place a form reaches a URL, and the text is the search itself (AGENTS.md section 11: no
    // personal data in a URL beyond `q`). The source guard allows exactly the search forms.
    <form
      role="search"
      method="get"
      action={`/${locale}/search`}
      aria-label={t("searchBox.label")}
      onSubmit={props.onSubmit}
      className="flex w-full items-center gap-2"
    >
      <div className="relative flex-1">
        <label htmlFor={id} className="sr-only">
          {t("searchBox.input")}
        </label>
        <Input
          id={id}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(activeId === undefined ? {} : { "aria-activedescendant": activeId })}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={200}
          placeholder={t("searchBox.input")}
          value={props.text}
          onChange={(event) => props.onTextChange(event.currentTarget.value)}
          onKeyDown={props.onKeyDown}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
        />
        <div className="absolute inset-x-0 z-20 mt-1">
          <ul
            id={listId}
            role="listbox"
            aria-label={t("searchBox.suggestions.label")}
            hidden={!showList}
            className="max-h-72 overflow-auto rounded-md border border-border bg-background py-1 text-foreground shadow-card"
          >
            {options.map((option, index) => (
              <li
                key={option.slug}
                id={optionId(listId, index)}
                role="option"
                aria-selected={combo.activeIndex === index}
                // The text box keeps the focus: a press must not blur it, or the list would close before the click.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => props.onHighlight(index)}
                onClick={() => props.onChoose(index)}
                className="cursor-pointer px-3 py-2 aria-selected:bg-primary aria-selected:text-primary-foreground"
              >
                {option.title}
              </li>
            ))}
          </ul>
          {showStatus ? (
            <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground shadow-card">
              {status === "loading" ? t("searchBox.loading") : null}
              {status === "ready" ? t("searchBox.empty") : null}
              {status === "error" && props.failure !== null ? failureText(t, props.failure) : null}
            </p>
          ) : null}
        </div>
        <LiveRegion visuallyHidden>{searchBoxAnnouncement(t, props)}</LiveRegion>
      </div>
      <Button type="submit" className="min-h-11">
        {t("searchBox.submit")}
      </Button>
    </form>
  );
}

function SearchBoxInner({ locale, initialText }: { locale: Locale; initialText: string }) {
  const { t } = useI18n();
  const client = useStoreClient();
  const router = useRouter();
  const id = `search-box-${useId().replace(/:/g, "")}`;
  const [source] = useState(() => createSuggestSource(client, locale));
  const lookup = useSyncExternalStore(source.subscribe, source.getState, source.getState);
  const [combo, dispatch] = useReducer(comboboxReducer, closedCombobox);
  const [text, setText] = useState(initialText);
  const options = lookup.items;

  // A strict-mode remount disposes and uses the same source again: dispose only cancels what is pending.
  useEffect(() => () => source.dispose(), [source]);

  // New suggestions: the highlight would point at another one.
  useEffect(() => {
    dispatch({ type: "optionsChanged" });
  }, [lookup.items]);

  useEffect(() => {
    if (combo.activeIndex < 0) return;
    document
      .getElementById(optionId(`${id}-list`, combo.activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [combo.activeIndex, id]);

  function choose(index: number): void {
    const item = options[index];
    if (item === undefined) return;
    dispatch({ type: "close" });
    source.reset();
    router.push(suggestionHref(locale, item.slug));
  }

  return (
    <SearchBoxView
      t={t}
      locale={locale}
      id={id}
      text={text}
      combo={combo}
      options={options}
      status={lookup.status}
      failure={lookup.failure}
      onTextChange={(next) => {
        setText(next);
        source.setQuery(next);
        dispatch({ type: "typed" });
      }}
      onKeyDown={(event) => {
        const outcome = suggestKey(combo, event.key, options.length);
        if (outcome.preventDefault) event.preventDefault();
        dispatch({ type: "key", key: event.key, count: options.length });
        if (event.key === "Enter" && outcome.select === null) dispatch({ type: "close" });
        if (outcome.select !== null) choose(outcome.select);
      }}
      onFocus={() => {
        if (text.trim().length > 0) dispatch({ type: "open" });
      }}
      onBlur={() => dispatch({ type: "close" })}
      onHighlight={(index) => dispatch({ type: "highlight", index })}
      onChoose={choose}
      onSubmit={() => source.reset()}
    />
  );
}

/**
 * The box with the words of the current results page in it (`?q=`), so the shopper can refine them. The inner box is keyed
 * by that text: a new search from elsewhere starts it over.
 */
export function SearchBox({ locale }: { locale: Locale }) {
  const params = useSearchParams();
  const pathname = usePathname();
  // Only the results page's own `?q=` is the shopper's words; another page that happens to carry a `q` is not.
  const fromAddress = pathname?.endsWith("/search") === true ? (params?.get("q") ?? "") : "";
  return <SearchBoxInner key={fromAddress} locale={locale} initialText={fromAddress} />;
}
