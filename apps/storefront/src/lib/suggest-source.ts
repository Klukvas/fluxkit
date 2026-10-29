import type { StoreClient } from "@fluxkit/api-client";
import type { Locale } from "@fluxkit/ui";
import { comboboxKey, closedCombobox, type ComboboxState, type KeyOutcome } from "./combobox-model";
import { createLookupSource, type LookupSource } from "./lookup-source";
import { localizedHref } from "./locale-path";

/**
 * Suggest-as-you-type of the header search box (plan 2026-10-29-search.md, section 9). It is the lookup source of the
 * delivery step (`lookup-source.ts`: debounce, minimum length, the request in flight aborted, a failure as a value)
 * pointed at `GET /store/search/suggest` on the page's own origin, with the keys of the combobox model, except Enter.
 * The browser sends the typed text and the locale, nothing else (no cookie is needed, none is read).
 */

/** The API refuses text shorter than 2 characters (`too_short`). */
export const SUGGEST_MIN_CHARS = 2;
/** Quiet time after the last key before a request is sent (plan: 200 ms). */
export const SUGGEST_DEBOUNCE_MS = 200;

export interface Suggestion {
  slug: string;
  title: string;
}

export function createSuggestSource(client: StoreClient, locale: string): LookupSource<Suggestion> {
  return createLookupSource<Suggestion>({
    minChars: SUGGEST_MIN_CHARS,
    debounceMs: SUGGEST_DEBOUNCE_MS,
    search: async (query, signal) => {
      const result = await client.suggestProducts(query, { locale, signal });
      if (!result.ok) return result;
      return {
        ok: true,
        status: result.status,
        data: { items: result.data.items, total: result.data.items.length, stale: false },
      };
    },
  });
}

/** The product page of a suggestion. */
export function suggestionHref(locale: Locale, slug: string): string {
  return localizedHref(locale, `/p/${encodeURIComponent(slug)}`);
}

/**
 * One key press in the search box. Arrows, Escape and Tab are the combobox model's. Enter differs from the pickers of the
 * delivery step: with a suggestion highlighted it opens that product; otherwise it SUBMITS the search (the box is a search
 * form first), and the list closes.
 */
export function suggestKey(state: ComboboxState, key: string, count: number): KeyOutcome {
  if (key === "Enter" && !(state.open && state.activeIndex >= 0 && state.activeIndex < count)) {
    return { state: closedCombobox, select: null, preventDefault: false };
  }
  return comboboxKey(state, key, count);
}
