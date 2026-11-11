import { knownPageIds, THEMES } from "./pages.ts";
import { SELECTOR_NAMES } from "./selectors.ts";
import { COMPUTED_PROPERTIES } from "./snapshot.ts";

/**
 * Declared exceptions of ONE pull request (`.visual/exceptions.json`; plan section 3 principle 2): differences the PR
 * means to make. `scripts/visual-compare.sh` honours only the entries this PR ADDED: an entry already in the merge-base's
 * file belongs to an earlier PR and is ignored (`ownExceptions`, compared by page, theme, selector and property; a changed
 * reason does not revive it), so an exception never outlives the PR that declared it. Old entries may stay in the file or
 * be removed by any PR; they declare nothing.
 *
 * The file is a JSON array of entries:
 *   { "page": "<page id>" | "*", "theme"?: "light" | "dark" | "system", "selector": "<selector name>",
 *     "property": "<computed property>" | "presence" | "*" | "screenshot", "reason": "<why>" }
 * - `property: "*"` covers every property and the presence of the element; `"presence"` only found vs absent,
 * - `property: "screenshot"` masks the element in the screenshots of that page (the computed styles are still compared),
 * - unknown fields, unknown pages, selectors or properties, an empty reason and duplicates are errors (a typo must not
 *   silently declare nothing).
 */

export const PRESENCE = "presence";
export const ANY_PROPERTY = "*";
export const SCREENSHOT_MASK = "screenshot";
export const ANY_PAGE = "*";

export interface VisualException {
  page: string;
  theme?: string;
  selector: string;
  property: string;
  reason: string;
}

const REQUIRED = ["page", "selector", "property", "reason"] as const;
const ALLOWED = new Set<string>([...REQUIRED, "theme"]);

export class ExceptionsError extends Error {}

function exceptionKey(entry: VisualException): string {
  return [entry.page, entry.theme ?? "", entry.selector, entry.property].join("|");
}

/** The entries of `current` that are not in `inherited` (the merge-base's file): the only ones a PR may use. */
export function ownExceptions(
  current: readonly VisualException[],
  inherited: readonly VisualException[],
): VisualException[] {
  const old = new Set(inherited.map(exceptionKey));
  return current.filter((entry) => !old.has(exceptionKey(entry)));
}

export function parseExceptions(value: unknown, source = "exceptions"): VisualException[] {
  if (!Array.isArray(value)) {
    throw new ExceptionsError(`${source}: must be a JSON array of exceptions.`);
  }
  const pages = knownPageIds();
  const properties = new Set<string>([
    ...COMPUTED_PROPERTIES,
    PRESENCE,
    ANY_PROPERTY,
    SCREENSHOT_MASK,
  ]);
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const at = `${source}[${String(index)}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ExceptionsError(`${at}: must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ALLOWED.has(key)) {
        throw new ExceptionsError(
          `${at}: unknown field "${key}" (allowed: ${[...ALLOWED].join(", ")}).`,
        );
      }
    }
    for (const key of REQUIRED) {
      const field = record[key];
      if (typeof field !== "string" || field.trim() === "") {
        throw new ExceptionsError(`${at}: "${key}" must be a non-empty string.`);
      }
    }
    const result: VisualException = {
      page: record["page"] as string,
      selector: record["selector"] as string,
      property: record["property"] as string,
      reason: (record["reason"] as string).trim(),
    };
    if (result.page !== ANY_PAGE && !pages.has(result.page)) {
      throw new ExceptionsError(
        `${at}: unknown page "${result.page}" (known: ${[...pages].join(", ")}, or "*").`,
      );
    }
    if (!SELECTOR_NAMES.has(result.selector)) {
      throw new ExceptionsError(
        `${at}: unknown selector "${result.selector}" (see e2e/support/visual/selectors.ts).`,
      );
    }
    if (!properties.has(result.property)) {
      throw new ExceptionsError(
        `${at}: unknown property "${result.property}" (a recorded property, "presence", "*" or "screenshot").`,
      );
    }
    if ("theme" in record) {
      const theme = record["theme"];
      if (typeof theme !== "string" || !(THEMES as readonly string[]).includes(theme)) {
        throw new ExceptionsError(`${at}: "theme" must be one of ${THEMES.join(", ")}.`);
      }
      result.theme = theme;
    }
    const key = exceptionKey(result);
    if (seen.has(key)) throw new ExceptionsError(`${at}: duplicate of an earlier exception.`);
    seen.add(key);
    return result;
  });
}

/** The selectors to mask in the screenshots of one page (`property: "screenshot"` entries for that page or `*`). */
export function screenshotMasks(
  exceptions: readonly VisualException[],
  pageId: string,
  theme: string,
): string[] {
  return exceptions
    .filter(
      (entry) =>
        entry.property === SCREENSHOT_MASK &&
        (entry.page === ANY_PAGE || entry.page === pageId) &&
        (entry.theme === undefined || entry.theme === theme),
    )
    .map((entry) => entry.selector);
}

/** The selector whose screenshot mask covers a whole page. */
export const WHOLE_PAGE_SELECTOR = "page.body";

/**
 * Whether a page's screenshots compare only the viewport: when the whole page is masked, a full-page shot can differ only in its
 * height, which a mask cannot declare (a PR that adds a breadcrumb row makes the page taller), so the frame keeps the viewport
 * size on both sides and the masked comparison is meaningful again.
 */
export function comparesViewportOnly(masks: readonly string[]): boolean {
  return masks.includes(WHOLE_PAGE_SELECTOR);
}
