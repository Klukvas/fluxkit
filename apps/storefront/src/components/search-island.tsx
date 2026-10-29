"use client";

import { Alert, Select, Spinner, type Locale } from "@fluxkit/ui";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { describeFormFailure } from "../lib/search-facets";
import { localizedHref } from "../lib/locale-path";
import {
  SEARCH_FILTERS_PANEL_ID,
  SEARCH_FORM_ID,
  SEARCH_RESULTS_HEADING_ID,
} from "../lib/search-ids";
import { parseSearchForm, searchPath, type SearchQuery } from "../lib/search-query";
import { useI18n } from "./i18n-provider";
import { focusRing } from "./styles";

/**
 * The few client parts of the results page (plan 2026-10-29-search.md, section 9). The page, the facet checkboxes and every
 * label are server markup passed in as children; these parts only add what a script is needed for:
 * - `SearchPending`: one `useTransition` for the filter form, the sort select and the results, so a change shows
 *   "updating" (dimmed, `aria-busy`) without moving anything, and the focus goes to the results heading when it is done;
 * - `SearchFilterForm`: the facet form is a plain GET form that works without a script. With one, the submit is checked in
 *   the browser (a bad price box is named, not sent) and navigates with the router, keeping the page's shell and focus;
 * - `SortSelect`: submits the form when the choice changes; `FiltersDisclosure`: the panel's toggle below the `lg` width.
 * Nothing here reads the API: the address is the state, the server renders it.
 */

interface PendingValue {
  pending: boolean;
  /** Goes to the results page of `query`, as a transition. */
  navigate(query: SearchQuery): void;
}

const PendingContext = createContext<PendingValue | null>(null);

function usePending(): PendingValue {
  const value = useContext(PendingContext);
  if (value === null) throw new Error("The search parts need a SearchPending above them.");
  return value;
}

export function SearchPending({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const wasPending = useRef(false);

  // The address changed and the new results arrived: the reading position is the results heading (a query-only change
  // keeps the path, so `RouteFocus` does not move it).
  useEffect(() => {
    if (wasPending.current && !pending) {
      const heading = document.getElementById(SEARCH_RESULTS_HEADING_ID);
      heading?.focus({ preventScroll: true });
    }
    wasPending.current = pending;
  }, [pending]);

  const value: PendingValue = {
    pending,
    navigate(query) {
      startTransition(() => {
        router.push(localizedHref(locale, searchPath(query)));
      });
    },
  };
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

/** The results area: dimmed and `aria-busy` while the next results load, with a status for screen readers. */
export function SearchResultsRegion({ children }: { children: ReactNode }) {
  const { pending } = usePending();
  const { t } = useI18n();
  return (
    <div aria-busy={pending} className={pending ? "relative opacity-60" : "relative"}>
      {pending ? (
        <div className="absolute end-2 top-2 z-10">
          <Spinner label={t("searchForm.updating")} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function SearchFilterForm({
  exponent,
  initialError = null,
  children,
}: {
  exponent: number;
  /** A failure the server already found (a script-less submit with a refused box, review F3), in the shop's words. */
  initialError?: string | null;
  children: ReactNode;
}) {
  const { navigate } = usePending();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(initialError);
  // Before the script runs the browser's own pattern check on the price boxes applies; once it runs, the form's own check
  // does (it says which box and in the shop's words), so the native one must not stop the submit first.
  const [scripted, setScripted] = useState(false);
  useEffect(() => {
    setScripted(true);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    for (const field of Array.from(form.elements)) field.removeAttribute("aria-invalid");
    const entries: [string, string][] = [];
    for (const [name, value] of new FormData(form)) {
      if (typeof value === "string") entries.push([name, value]);
    }
    const parsed = parseSearchForm(entries, exponent);
    if (!parsed.ok) {
      const failure = describeFormFailure(parsed.reason);
      setError(t(failure.messageKey));
      if (failure.field !== null) {
        const field = form.elements.namedItem(failure.field);
        if (field instanceof HTMLInputElement) {
          field.setAttribute("aria-invalid", "true");
          field.focus();
        }
      }
      return;
    }
    setError(null);
    navigate(parsed.query);
  }

  return (
    // GET: without a script the browser submits the same fields to the same page, which turns them into the short address
    // (`isCanonicalSearch`). The source guard allows exactly the search forms.
    <form
      id={SEARCH_FORM_ID}
      method="get"
      noValidate={scripted}
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
    >
      {error === null ? null : (
        <Alert variant="danger" title={t("searchForm.error.title")}>
          <p>{error}</p>
        </Alert>
      )}
      {children}
    </form>
  );
}

export function SortSelect({
  label,
  options,
  selected,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: string;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-foreground">
      <span>{label}</span>
      <Select
        // The select belongs to the filter form (a form attribute), so one submit carries the sort and the filters.
        form={SEARCH_FORM_ID}
        name="sort"
        defaultValue={selected}
        className="w-auto"
        onChange={(event) => {
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** The panel of filters: always shown from the `lg` width, behind a toggle button below it. */
export function FiltersDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = SEARCH_FILTERS_PANEL_ID;
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex min-h-11 items-center justify-between rounded-md border border-border px-4 text-foreground lg:hidden ${focusRing}`}
      >
        {title}
      </button>
      <div id={panelId} className={open ? "block" : "hidden lg:block"}>
        {children}
      </div>
    </div>
  );
}
