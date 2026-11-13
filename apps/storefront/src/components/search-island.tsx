"use client";

import { Alert, Spinner, textStyles, VisuallyHidden, type Locale } from "@fluxkit/ui";
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
  type Ref,
} from "react";
import { floatingTop, isFormChanged } from "../lib/filter-draft";
import { nextTrapIndex } from "../lib/mobile-ux";
import { describeFormFailure } from "../lib/search-facets";
import { localizedHref } from "../lib/locale-path";
import {
  SEARCH_FILTERS_PANEL_ID,
  SEARCH_FORM_ID,
  SEARCH_RESULTS_HEADING_ID,
} from "../lib/search-ids";
import { parseSearchForm, searchPath, type SearchQuery } from "../lib/search-query";
import { useI18n } from "./i18n-provider";
import { CloseIcon } from "./icons";
import { focusRing } from "./styles";

/**
 * The few client parts of the results page (plan 2026-10-29-search.md, section 9). The page, the facet checkboxes and every
 * label are server markup passed in as children; these parts only add what a script is needed for:
 * - `SearchPending`: one `useTransition` for the filter form, the sort and the results, so a change shows
 *   "updating" (dimmed, `aria-busy`) without moving anything, and the focus goes to the results heading when it is done;
 * - `SearchFilterForm`: the facet form is a plain GET form that works without a script. With one, the submit is checked in
 *   the browser (a bad price box is named, not sent) and navigates with the router, keeping the page's shell and focus;
 * - `FiltersButton` and `FilterSheet`: below the `lg` width the panel is a full-screen modal sheet (mobile batch, review D-05).
 * Nothing here reads the API: the address is the state, the server renders it.
 */

interface PendingValue {
  pending: boolean;
  /** Goes to the results page of `query`, as a transition. */
  navigate(query: SearchQuery): void;
  /** The mobile filter sheet is open (below `lg`, with a script). */
  sheetOpen: boolean;
  setSheetOpen(open: boolean): void;
}

const PendingContext = createContext<PendingValue | null>(null);

function usePending(): PendingValue {
  const value = useContext(PendingContext);
  if (value === null) throw new Error("The search parts need a SearchPending above them.");
  return value;
}

export function SearchPending({
  locale,
  basePath = "/search",
  children,
}: {
  locale: Locale;
  /** Locale-less path the filter form navigates on (`/search`, or `/catalog` and `/c/<slug>` with search on). */
  basePath?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const wasPending = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The address changed and the new results arrived: the reading position is the results heading (a query-only change
  // keeps the path, so `RouteFocus` does not move it).
  useEffect(() => {
    if (wasPending.current && !pending) {
      const heading = document.getElementById(SEARCH_RESULTS_HEADING_ID);
      heading?.focus({ preventScroll: true });
    }
    wasPending.current = pending;
  }, [pending]);

  // Applying from the sheet closes it: the new results are what the shopper looks at next.
  useEffect(() => {
    if (pending) setSheetOpen(false);
  }, [pending]);

  const value: PendingValue = {
    pending,
    sheetOpen,
    setSheetOpen,
    navigate(query) {
      startTransition(() => {
        router.push(localizedHref(locale, searchPath(query, basePath)));
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

/**
 * The floating "Apply filters" button (owner request 2026-11-02): it appears next to the row of the control the shopper
 * changed (to the right of the panel from `lg`, at the row's end below it) and stays while the form differs from the
 * rendered page. It is a pointer shortcut: the bottom "Apply" button stays the one in the tab order, and a polite status
 * tells assistive technology that changes wait to be applied, so the floating copy is `aria-hidden` and not focusable.
 * Without a script it never appears (the form is a plain GET form).
 */
export function FloatingApplyView({
  visible,
  label,
  pendingText,
  buttonRef,
}: {
  visible: boolean;
  label: string;
  pendingText: string;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <>
      <VisuallyHidden>
        <span role="status" aria-live="polite">
          {visible ? pendingText : ""}
        </span>
      </VisuallyHidden>
      <button
        ref={buttonRef}
        type="submit"
        tabIndex={-1}
        aria-hidden="true"
        hidden={!visible}
        className="absolute end-2 z-20 inline-flex min-h-11 items-center whitespace-nowrap rounded-control bg-primary px-4 font-medium text-primary-foreground shadow-card lg:end-auto lg:start-full lg:ms-3"
      >
        {label}
      </button>
    </>
  );
}

export function SearchFilterForm({
  exponent,
  initialError = null,
  action,
  children,
}: {
  /**
   * The page's own path: a submit without a script goes there, so the `#search-filters-panel` fragment that opened the
   * panel (`:target`) is not carried to the results.
   */
  action: string;
  exponent: number;
  /** A failure the server already found (a script-less submit with a refused box, review F3), in the shop's words. */
  initialError?: string | null;
  children: ReactNode;
}) {
  const { navigate, pending, sheetOpen } = usePending();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(initialError);
  const formRef = useRef<HTMLFormElement>(null);
  const floatingRef = useRef<HTMLButtonElement>(null);
  /** The row of the last changed control while the form differs from the page, else `null`. */
  const [changedRow, setChangedRow] = useState<HTMLElement | null>(null);

  function onDraftChange(event: FormEvent<HTMLFormElement>): void {
    const form = event.currentTarget;
    const target = event.target;
    // The sort (`sort-menu.tsx`) submits by itself; a change elsewhere is a draft until it is applied.
    if (!(target instanceof HTMLElement) || target.getAttribute("name") === "sort") return;
    const controls = Array.from(form.elements).filter(
      (element): element is HTMLInputElement | HTMLSelectElement =>
        (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) &&
        element.name !== "sort",
    );
    setChangedRow(
      isFormChanged(controls)
        ? (target.closest("li, label, fieldset") as HTMLElement | null)
        : null,
    );
  }

  // Place the floating button on the changed row, and keep it there when a facet list scrolls or the window resizes.
  useEffect(() => {
    const form = formRef.current;
    const button = floatingRef.current;
    if (changedRow === null || form === null || button === null) return;
    const place = () => {
      const formBox = form.getBoundingClientRect();
      const rowBox = changedRow.getBoundingClientRect();
      button.style.top = `${String(floatingTop(rowBox, formBox, button.offsetHeight))}px`;
    };
    place();
    form.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      form.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [changedRow]);

  // A new page (the filters were applied) renders new defaults: nothing is pending any more.
  useEffect(() => {
    if (pending) setChangedRow(null);
  }, [pending]);
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
      ref={formRef}
      id={SEARCH_FORM_ID}
      method="get"
      action={action}
      noValidate={scripted}
      onSubmit={onSubmit}
      onChange={onDraftChange}
      onInput={onDraftChange}
      aria-busy={pending}
      className="relative flex flex-col gap-4"
    >
      <FloatingApplyView
        // In the mobile sheet the sticky Apply at its bottom does this job.
        visible={changedRow !== null && !pending && !sheetOpen}
        label={t("searchForm.applyChanged")}
        pendingText={t("searchForm.changesPending")}
        buttonRef={floatingRef}
      />
      {error === null ? null : (
        <Alert variant="danger" title={t("searchForm.error.title")}>
          <p>{error}</p>
        </Alert>
      )}
      {children}
    </form>
  );
}

/**
 * "Filters (N)" below the `lg` width, next to the sort (review D-05). Without a script it is a link to the panel, which CSS
 * `:target` then shows in place (the plain GET form, `.fk-filter-panel` in `app/globals.css`); with one it opens the sheet.
 */
export function FiltersButton({ label }: { label: string }) {
  const { sheetOpen, setSheetOpen } = usePending();
  return (
    <a
      href={`#${SEARCH_FILTERS_PANEL_ID}`}
      id={FILTERS_BUTTON_ID}
      aria-controls={SEARCH_FILTERS_PANEL_ID}
      aria-haspopup="dialog"
      aria-expanded={sheetOpen}
      onClick={(event) => {
        event.preventDefault();
        setSheetOpen(true);
      }}
      className={`inline-flex min-h-11 items-center gap-2 rounded-control border border-border-input bg-background px-4 font-medium text-foreground lg:hidden ${focusRing}`}
    >
      {label}
    </a>
  );
}

const FILTERS_BUTTON_ID = "search-filters-button";
const SHEET_TITLE_ID = "search-filters-sheet-title";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The controls of `root` a Tab can reach (visible ones: a closed group's checkboxes are skipped). */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0 && element.tabIndex !== -1,
  );
}

/**
 * The filter panel: a sidebar from the `lg` width; below it hidden until "Filters" opens it as a full-screen modal sheet
 * (`role="dialog"`, `aria-modal`, the page behind it does not scroll, Tab stays inside, Escape or the close button close
 * it and give the focus back to "Filters"). The sheet is the same form, not a copy. It closes by itself when the filters
 * are applied (the results load) and when the window grows to the sidebar width.
 */
export function FilterSheet({
  title,
  closeLabel,
  children,
}: {
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const { sheetOpen, setSheetOpen } = usePending();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!sheetOpen) {
      if (wasOpen.current) {
        wasOpen.current = false;
        document.documentElement.classList.remove("overflow-hidden");
        document.getElementById(FILTERS_BUTTON_ID)?.focus({ preventScroll: true });
      }
      return;
    }
    wasOpen.current = true;
    document.documentElement.classList.add("overflow-hidden");
    closeRef.current?.focus();
    const wide = window.matchMedia("(min-width: 64rem)");
    const onWide = () => {
      if (wide.matches) setSheetOpen(false);
    };
    wide.addEventListener("change", onWide);
    // Back (or Forward) while the sheet is open goes to the other results with the sheet closed (review m4 of PR 216).
    const onHistory = () => setSheetOpen(false);
    window.addEventListener("popstate", onHistory);
    return () => {
      window.removeEventListener("popstate", onHistory);
      wide.removeEventListener("change", onWide);
      document.documentElement.classList.remove("overflow-hidden");
    };
  }, [sheetOpen, setSheetOpen]);

  return (
    <div
      ref={panelRef}
      id={SEARCH_FILTERS_PANEL_ID}
      {...(sheetOpen
        ? { role: "dialog", "aria-modal": true, "aria-labelledby": SHEET_TITLE_ID }
        : {})}
      className={sheetOpen ? "fk-filter-panel fk-open" : "fk-filter-panel"}
      onKeyDown={(event) => {
        if (!sheetOpen) return;
        if (event.key === "Escape") {
          event.preventDefault();
          setSheetOpen(false);
          return;
        }
        if (event.key !== "Tab" || panelRef.current === null) return;
        const items = focusables(panelRef.current);
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = nextTrapIndex(items.length, current, event.shiftKey);
        if (next !== null) {
          event.preventDefault();
          items[next]?.focus();
        }
      }}
    >
      {sheetOpen ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <h2 id={SHEET_TITLE_ID} className={textStyles.subsectionTitle}>
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={closeLabel}
            onClick={() => setSheetOpen(false)}
            className={`inline-flex size-11 items-center justify-center rounded-control hover:bg-muted ${focusRing}`}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      <div className={sheetOpen ? "flex-1 overflow-y-auto px-4 pb-0 pt-4" : ""}>{children}</div>
    </div>
  );
}
