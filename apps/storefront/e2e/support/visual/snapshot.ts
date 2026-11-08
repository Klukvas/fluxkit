import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SELECTOR_LIST_VERSION } from "./selectors.ts";

/**
 * Computed-style snapshots of the visual harness. The spec (`tests/computed-styles.visual.ts`) writes one FRAGMENT per page
 * and theme (`<dir>/<page>.<theme>.json`, so a retried test overwrites only its own file); `loadSnapshot` merges a directory
 * of fragments (or reads one merged file) into a `Snapshot` that `compare.ts` diffs.
 */

export const SNAPSHOT_FORMAT = "fluxkit-computed-styles";
export const SNAPSHOT_FORMAT_VERSION = 1;

/**
 * The recorded properties, as longhands: a shorthand's serialisation differs between browsers and versions, a longhand's
 * does not. Order is the report order.
 */
export const COMPUTED_PROPERTIES: readonly string[] = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "box-shadow",
  "outline-color",
  "outline-style",
  "outline-width",
  "outline-offset",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "aspect-ratio",
];

/** Property values of one element, or `null` when the selector found no visible element on that page. */
export type ElementStyles = Record<string, string> | null;

export interface SnapshotFragment {
  format: typeof SNAPSHOT_FORMAT;
  formatVersion: number;
  selectorListVersion: number;
  properties: readonly string[];
  page: string;
  theme: string;
  path: string;
  styles: Record<string, ElementStyles>;
}

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  formatVersion: number;
  selectorListVersion: number;
  properties: readonly string[];
  /** page id -> theme -> selector name -> styles. */
  pages: Record<string, Record<string, Record<string, ElementStyles>>>;
}

export function fragment(
  page: string,
  theme: string,
  path: string,
  styles: Record<string, ElementStyles>,
): SnapshotFragment {
  return {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    selectorListVersion: SELECTOR_LIST_VERSION,
    properties: COMPUTED_PROPERTIES,
    page,
    theme,
    path,
    styles,
  };
}

export function fragmentFileName(page: string, theme: string): string {
  return `${page}.${theme}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkHeader(value: Record<string, unknown>, source: string): void {
  if (value["format"] !== SNAPSHOT_FORMAT) {
    throw new Error(
      `${source}: not a computed-style snapshot (format ${String(value["format"])}).`,
    );
  }
  if (value["formatVersion"] !== SNAPSHOT_FORMAT_VERSION) {
    throw new Error(
      `${source}: format version ${String(value["formatVersion"])}, this harness reads ${String(SNAPSHOT_FORMAT_VERSION)}.`,
    );
  }
  if (typeof value["selectorListVersion"] !== "number" || !Array.isArray(value["properties"])) {
    throw new Error(`${source}: selectorListVersion or properties missing.`);
  }
}

/** Merges fragments into one snapshot. Fragments of different harness versions, or two for one page and theme, are an error. */
export function mergeFragments(fragments: readonly SnapshotFragment[]): Snapshot {
  const first = fragments[0];
  if (first === undefined) throw new Error("No computed-style fragments to merge.");
  const snapshot: Snapshot = {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    selectorListVersion: first.selectorListVersion,
    properties: first.properties,
    pages: {},
  };
  for (const part of fragments) {
    if (part.selectorListVersion !== snapshot.selectorListVersion) {
      throw new Error(
        `Fragment ${part.page}/${part.theme} has selector list version ${String(part.selectorListVersion)}, others ${String(snapshot.selectorListVersion)}.`,
      );
    }
    if (part.properties.join(",") !== snapshot.properties.join(",")) {
      throw new Error(`Fragment ${part.page}/${part.theme} records other properties.`);
    }
    const themes = (snapshot.pages[part.page] ??= {});
    if (themes[part.theme] !== undefined) {
      throw new Error(`Two fragments for ${part.page}/${part.theme}.`);
    }
    themes[part.theme] = part.styles;
  }
  return snapshot;
}

function parseFragment(value: unknown, source: string): SnapshotFragment {
  if (!isRecord(value)) throw new Error(`${source}: not a JSON object.`);
  checkHeader(value, source);
  if (
    typeof value["page"] !== "string" ||
    typeof value["theme"] !== "string" ||
    !isRecord(value["styles"])
  ) {
    throw new Error(`${source}: page, theme or styles missing.`);
  }
  return value as unknown as SnapshotFragment;
}

/** Reads a merged snapshot file, or merges every `*.json` fragment of a directory (sorted, so the result is stable). */
export function loadSnapshot(path: string): Snapshot {
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path)
      .filter((name) => name.endsWith(".json"))
      .sort();
    if (files.length === 0) throw new Error(`${path}: no computed-style fragments.`);
    return mergeFragments(
      files.map((name) =>
        parseFragment(JSON.parse(readFileSync(join(path, name), "utf8")), join(path, name)),
      ),
    );
  }
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`${path}: not a JSON object.`);
  checkHeader(value, path);
  if (!isRecord(value["pages"])) throw new Error(`${path}: pages missing.`);
  return value as unknown as Snapshot;
}
