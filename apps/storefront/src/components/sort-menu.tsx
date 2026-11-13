"use client";

import type { SearchSort } from "@fluxkit/api-client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type SVGProps,
} from "react";
import { SEARCH_FORM_ID } from "../lib/search-ids";
import { useDismiss } from "./header-menu";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, SparkleIcon, TargetIcon } from "./icons";
import { focusRing } from "./styles";

/** The decorative icon of each sort (owner feedback 2026-11-13, plan `docs/plans/2026-11-13-storefront-ui-round-4.md` B). */
const SORT_ICONS: Record<SearchSort, ComponentType<SVGProps<SVGSVGElement>>> = {
  relevance: TargetIcon,
  newest: SparkleIcon,
  price_asc: ArrowUpIcon,
  price_desc: ArrowDownIcon,
};

export interface SortChoice {
  value: SearchSort;
  /** The sort's translated name. */
  label: string;
  /** The localized address of the list in this sort (filters and view kept, page 1). */
  href: string;
}

/** A plain click: a modified or middle click opens the link's own address in a new tab or window, as any link does. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The sort of a faceted list (plan 2026-11-13 B, council decision 5): a native `<details>` whose summary shows the current
 * sort's icon and name, and whose panel lists every sort as a link (`aria-current` on the chosen one). Before hydration the
 * summary opens the panel and a link goes to its address. With a script it behaves like the native select it replaces: a
 * choice submits the filter form (the hidden `sort` field belongs to it by its `form` attribute), so pending filter changes
 * go along, the address resets to page 1 and the focus moves to the result count (`SearchPending`); Escape, a click or a
 * focus outside close the panel (`useDismiss`, Escape gives the focus back to the summary). The hidden field also keeps
 * the sort when the filters are applied.
 */
export function SortMenu({
  label,
  choices,
  selected,
}: {
  /** The visible "Sort by" text; the summary's accessible name is it plus the current sort. */
  label: string;
  choices: readonly SortChoice[];
  selected: SearchSort;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const currentId = useId();
  useDismiss(detailsRef);
  // A panel opened before hydration: show its real state.
  useEffect(() => {
    if (detailsRef.current?.open === true) setOpen(true);
  }, []);

  const current = choices.find((choice) => choice.value === selected) ?? choices[0];
  if (current === undefined) return null;
  const CurrentIcon = SORT_ICONS[current.value];

  function choose(event: MouseEvent<HTMLAnchorElement>, value: SearchSort): void {
    if (!isPlainClick(event)) return;
    const field = fieldRef.current;
    const form = field?.form ?? null;
    // No filter form on the page: the link's own address is the same state.
    if (field === null || form === null) return;
    event.preventDefault();
    if (detailsRef.current !== null) detailsRef.current.open = false;
    field.value = value;
    form.requestSubmit();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 text-foreground lg:flex-none lg:flex-row lg:items-center lg:gap-2">
      <span id={labelId}>{label}</span>
      <input ref={fieldRef} type="hidden" form={SEARCH_FORM_ID} name="sort" value={selected} />
      <details
        ref={detailsRef}
        className="group relative"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          role="button"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${currentId}`}
          className="fk-sort-summary"
        >
          <CurrentIcon />
          <span id={currentId} className="min-w-0 truncate">
            {current.label}
          </span>
          <ChevronDownIcon className="fk-chevron ms-auto shrink-0" />
        </summary>
        <ul className="absolute end-0 top-full z-30 mt-1 w-max min-w-full max-w-72 rounded-control border border-border bg-background p-1 shadow-overlay">
          {choices.map((choice) => {
            const Icon = SORT_ICONS[choice.value];
            const isCurrent = choice.value === current.value;
            return (
              <li key={choice.value}>
                <a
                  href={choice.href}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={(event) => choose(event, choice.value)}
                  className={`flex min-h-11 items-center gap-2 rounded-control px-3 py-2 text-foreground hover:bg-muted ${
                    isCurrent ? "bg-muted font-semibold" : ""
                  } ${focusRing}`}
                >
                  <Icon className="shrink-0" />
                  <span>{choice.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
