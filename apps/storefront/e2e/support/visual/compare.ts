import {
  ANY_PAGE,
  ANY_PROPERTY,
  PRESENCE,
  SCREENSHOT_MASK,
  type VisualException,
} from "./exceptions.ts";
import type { ElementStyles, Snapshot } from "./snapshot.ts";

/**
 * Diff of two computed-style snapshots (base vs pull request). Zero tolerance: any changed string is a difference
 * (plan section 7). Pure functions, covered by `compare.spec.ts`.
 */

/** Marker values for `presence` differences and for a page or theme recorded on one side only. */
export const PRESENT = "present";
export const ABSENT = "absent";
export const NOT_RECORDED = "not recorded";

export interface Difference {
  page: string;
  theme: string;
  selector: string;
  /** A recorded property, `presence` (found vs absent) or `*` (the whole page/theme was recorded on one side only). */
  property: string;
  before: string;
  after: string;
}

export interface Comparison {
  undeclared: Difference[];
  declared: { difference: Difference; reason: string }[];
  /** Computed-style exceptions that matched no difference (stale or mistyped; reported, not fatal). */
  unused: VisualException[];
}

export class IncomparableSnapshotsError extends Error {}

function sortedKeys(...records: (Record<string, unknown> | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const record of records) for (const key of Object.keys(record ?? {})) keys.add(key);
  return [...keys].sort();
}

function compareElement(
  page: string,
  theme: string,
  selector: string,
  before: ElementStyles | undefined,
  after: ElementStyles | undefined,
  properties: readonly string[],
): Difference[] {
  const beforeFound = before !== undefined && before !== null;
  const afterFound = after !== undefined && after !== null;
  if (!beforeFound || !afterFound) {
    if (beforeFound === afterFound) return [];
    return [
      {
        page,
        theme,
        selector,
        property: PRESENCE,
        before: beforeFound ? PRESENT : ABSENT,
        after: afterFound ? PRESENT : ABSENT,
      },
    ];
  }
  const differences: Difference[] = [];
  for (const property of properties) {
    const left = before[property] ?? NOT_RECORDED;
    const right = after[property] ?? NOT_RECORDED;
    if (left !== right) {
      differences.push({ page, theme, selector, property, before: left, after: right });
    }
  }
  return differences;
}

/** Every difference between two snapshots, in page, theme, selector and property order. */
export function diffSnapshots(before: Snapshot, after: Snapshot): Difference[] {
  if (before.selectorListVersion !== after.selectorListVersion) {
    throw new IncomparableSnapshotsError(
      `Selector list version ${String(before.selectorListVersion)} vs ${String(after.selectorListVersion)}: both sides must run the same harness (scripts/visual-compare.sh copies it into the base tree).`,
    );
  }
  if (before.properties.join(",") !== after.properties.join(",")) {
    throw new IncomparableSnapshotsError(
      "The snapshots record different property lists: both sides must run the same harness.",
    );
  }
  const differences: Difference[] = [];
  for (const page of sortedKeys(before.pages, after.pages)) {
    const beforeThemes = before.pages[page];
    const afterThemes = after.pages[page];
    for (const theme of sortedKeys(beforeThemes, afterThemes)) {
      const left = beforeThemes?.[theme];
      const right = afterThemes?.[theme];
      if (left === undefined || right === undefined) {
        differences.push({
          page,
          theme,
          selector: ANY_PROPERTY,
          property: ANY_PROPERTY,
          before: left === undefined ? NOT_RECORDED : PRESENT,
          after: right === undefined ? NOT_RECORDED : PRESENT,
        });
        continue;
      }
      for (const selector of sortedKeys(left, right)) {
        differences.push(
          ...compareElement(
            page,
            theme,
            selector,
            left[selector],
            right[selector],
            before.properties,
          ),
        );
      }
    }
  }
  return differences;
}

function matches(exception: VisualException, difference: Difference): boolean {
  if (exception.property === SCREENSHOT_MASK) return false;
  if (exception.page !== ANY_PAGE && exception.page !== difference.page) return false;
  if (exception.theme !== undefined && exception.theme !== difference.theme) return false;
  if (exception.selector !== difference.selector) return false;
  return exception.property === ANY_PROPERTY || exception.property === difference.property;
}

/** Splits differences into declared (first matching exception wins) and undeclared ones. */
export function applyExceptions(
  differences: readonly Difference[],
  exceptions: readonly VisualException[],
): Comparison {
  const used = new Set<VisualException>();
  const comparison: Comparison = { undeclared: [], declared: [], unused: [] };
  for (const difference of differences) {
    const exception = exceptions.find((candidate) => matches(candidate, difference));
    if (exception === undefined) {
      comparison.undeclared.push(difference);
    } else {
      used.add(exception);
      comparison.declared.push({ difference, reason: exception.reason });
    }
  }
  comparison.unused = exceptions.filter(
    (entry) => entry.property !== SCREENSHOT_MASK && !used.has(entry),
  );
  return comparison;
}

function table(rows: readonly string[][]): string {
  const header = ["page", "theme", "selector", "property", "before", "after"];
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? "").length)),
  );
  const line = (row: readonly string[]) =>
    row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ");
  return [line(header), widths.map((width) => "-".repeat(width)).join("-|-"), ...rows.map(line)]
    .map((text) => text.trimEnd())
    .join("\n");
}

const row = (difference: Difference) => [
  difference.page,
  difference.theme,
  difference.selector,
  difference.property,
  difference.before,
  difference.after,
];

/** A plain-text report for the console and `.visual/report/computed-styles.txt`. */
export function formatComparison(comparison: Comparison): string {
  const parts: string[] = [];
  if (comparison.undeclared.length === 0) {
    parts.push("Computed styles: no undeclared difference.");
  } else {
    parts.push(
      `Computed styles: ${String(comparison.undeclared.length)} UNDECLARED difference(s) (a defect, or declare it in .visual/exceptions.json with a reason):`,
      "",
      table(comparison.undeclared.map(row)),
    );
  }
  if (comparison.declared.length > 0) {
    parts.push(
      "",
      `Declared differences (${String(comparison.declared.length)}):`,
      "",
      table(comparison.declared.map(({ difference }) => row(difference))),
      "",
      "Reasons:",
      ...[...new Set(comparison.declared.map(({ reason }) => reason))].map(
        (reason) => `- ${reason}`,
      ),
    );
  }
  if (comparison.unused.length > 0) {
    parts.push(
      "",
      `Exceptions that matched nothing (${String(comparison.unused.length)}; remove them or fix the names):`,
      ...comparison.unused.map(
        (entry) =>
          `- page ${entry.page}${entry.theme === undefined ? "" : ` theme ${entry.theme}`} selector ${entry.selector} property ${entry.property}: ${entry.reason}`,
      ),
    );
  }
  return parts.join("\n");
}
