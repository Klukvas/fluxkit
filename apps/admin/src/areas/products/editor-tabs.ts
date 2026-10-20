import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import type { EditorTabId } from "./publish-problems";

/**
 * The editor's tab state: the selected tab lives in the URL (`?tab=`, so a link opens the right tab), the visible tabs
 * follow the session's permissions, and each tab reports whether it has unsaved changes. Switching tabs changes the query
 * string, so the dirty tab's own unsaved-changes guard asks before its input is dropped (`router/unsaved-changes.ts`);
 * the shell uses the dirty state to keep the lifecycle actions (which reload the product) locked meanwhile. Pure.
 */
export interface TabPermission {
  id: EditorTabId;
  operation: AdminOperationName;
}

export function visibleTabs<Tab extends TabPermission>(
  tabs: readonly Tab[],
  permissions: readonly string[] | null,
): Tab[] {
  return tabs.filter((tab) => canRun(permissions, tab.operation));
}

/** The tab of the URL; a missing, unknown or hidden one is the first visible tab; `null` when none is visible. */
export function readTab(
  params: URLSearchParams,
  visible: readonly EditorTabId[],
): EditorTabId | null {
  const wanted = params.get("tab");
  const found = visible.find((id) => id === wanted);
  return found ?? visible[0] ?? null;
}

/** The query string of a tab: the first tab is the bare path. */
export function tabSearch(tab: EditorTabId, visible: readonly EditorTabId[]): string {
  return tab === visible[0] ? "" : `?tab=${encodeURIComponent(tab)}`;
}

export type DirtyTabs = Readonly<Partial<Record<EditorTabId, true>>>;

export const NO_DIRTY_TABS: DirtyTabs = {};

/** The state with one tab's flag set; the same object when nothing changes (no needless render). */
export function withDirty(state: DirtyTabs, tab: EditorTabId, dirty: boolean): DirtyTabs {
  if ((state[tab] === true) === dirty) return state;
  const next: Partial<Record<EditorTabId, true>> = {};
  for (const [id, flag] of Object.entries(state) as [EditorTabId, true][]) {
    if (id !== tab && flag) next[id] = true;
  }
  if (dirty) next[tab] = true;
  return next;
}

/** The tab with unsaved changes (only the shown tab is mounted, so at most one), or `null`. */
export function dirtyTab(state: DirtyTabs): EditorTabId | null {
  const found = Object.keys(state)[0];
  return found === undefined ? null : (found as EditorTabId);
}

/** What `productRevision` reads of a product detail. */
export interface RevisionSource {
  updatedAt: string;
  categories: readonly { categoryId: string; isPrimary: boolean; position: number }[];
  media: readonly { id: string; updatedAt: string }[];
  options: readonly { optionId: string; values: readonly { optionValueId: string }[] }[];
  variants: readonly { id: string; updatedAt: string }[];
}

/**
 * A short fingerprint of the stored content a tab shows, for its `key`: the editor remounts the tab when it changes, so
 * after a write the form shows what the server stored (a variant, media or option write does not change the product's
 * own `updatedAt`). A reload that finds the same content (a lost answer whose write did not land) keeps the tab and its
 * input. FNV-1a over the ids and timestamps; not a security measure.
 */
export function productRevision(product: RevisionSource): string {
  const text = [
    product.updatedAt,
    product.categories.map((entry) => `${entry.categoryId}:${entry.isPrimary}:${entry.position}`),
    product.media.map((entry) => `${entry.id}@${entry.updatedAt}`),
    product.options.map(
      (entry) => `${entry.optionId}=${entry.values.map((value) => value.optionValueId).join(",")}`,
    ),
    product.variants.map((entry) => `${entry.id}@${entry.updatedAt}`),
  ].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
