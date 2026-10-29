import { hasControlCharacter } from "./patterns.js";
import { normalizeSearchWords } from "./query.js";

/**
 * Indexing rules of the search pipeline (ADR 0034 decision 5): queue backoff, index names, the decision a job takes for
 * one locale, synonym terms. Pure; the API feeds it the stored state.
 */

export const SEARCH_INDEXING = Object.freeze({
  /** A claimed queue row belongs to its job run for this long; a crashed run's rows are claimed again afterwards. */
  syncLeaseSeconds: 120,
  /** Product ids per sync page and pages per run. */
  syncPageSize: 100,
  syncMaxPages: 20,
  /** How long a sync or rebuild waits for one engine task. */
  taskTimeoutMs: 20_000,
  /** Products read per rebuild page; documents are sent in batches of at most `rebuildBatchDocuments`. */
  rebuildPageProducts: 200,
  rebuildBatchDocuments: 1_000,
  /** A build that has not swapped after this long is dropped and started again. */
  buildMaxAgeHours: 24,
  /** A fan-out writer that would enqueue more products than this requests a rebuild instead. */
  fanOutRebuildThreshold: 5_000,
  /** From this many failed attempts a row counts as dead in the status (it keeps retrying hourly). */
  deadAfterAttempts: 10,
  /** Finished engine tasks older than this are pruned by the sync job (spike S1, E11). */
  taskRetentionMinutes: 60,
});

/** Why a product was marked for sync; stored in `search_sync_queue.reason` (the last writer wins). */
export const SEARCH_SYNC_REASONS = [
  "product_changed",
  "variant_changed",
  "price_changed",
  "stock_changed",
  "reservation_changed",
  "brand_changed",
  "category_changed",
  "option_changed",
  "attribute_changed",
  "stale_hit",
] as const;

export type SearchSyncReason = (typeof SEARCH_SYNC_REASONS)[number];

const BACKOFF_MINUTES = [1, 2, 5, 10, 30] as const;
const HOURLY_MINUTES = 60;

/** When a queue row whose sync failed `attempts` times is due again: 1, 2, 5, 10, 30 minutes, then every hour. */
export function nextSearchSyncAttemptAt(attempts: number, now: Date): Date {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be a whole number of at least 1");
  }
  const waitMinutes = BACKOFF_MINUTES[attempts - 1] ?? HOURLY_MINUTES;
  return new Date(now.getTime() + waitMinutes * 60_000);
}

/** `MEILI_INDEX_PREFIX`: lower case, ends with `_`, at most 33 characters (plan section 7). */
export const SEARCH_INDEX_PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,31}_$/;
/** Every index uid the API writes (a subset of what the engine allows). */
export const SEARCH_INDEX_UID_PATTERN = /^[a-z0-9_]{1,128}$/;
const LOCALE_PATTERN = /^[a-z]{2,8}(-[a-z]{2,8})*$/;
const CATALOG_FAMILY = "catalog_";

/** The uid of a locale's live index: `<prefix>catalog_<locale>`, a dash of the locale becomes `_`. */
export function searchLiveIndexUid(prefix: string, locale: string): string {
  if (!SEARCH_INDEX_PREFIX_PATTERN.test(prefix)) {
    throw new RangeError("The index prefix must match ^[a-z][a-z0-9_]{0,31}_$");
  }
  if (!LOCALE_PATTERN.test(locale)) {
    throw new RangeError("The locale must be a lower-case locale code");
  }
  const uid = `${prefix}${CATALOG_FAMILY}${locale.replace(/-/g, "_")}`;
  if (!SEARCH_INDEX_UID_PATTERN.test(uid)) {
    throw new RangeError("The index uid would be too long");
  }
  return uid;
}

function stamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[-:T]/g, "");
}

/** The uid of a new build of a locale's index: the live uid plus a UTC stamp to the second. */
export function searchBuildIndexUid(prefix: string, locale: string, now: Date): string {
  const uid = `${searchLiveIndexUid(prefix, locale)}_${stamp(now)}`;
  if (!SEARCH_INDEX_UID_PATTERN.test(uid)) {
    throw new RangeError("The build index uid would be too long");
  }
  return uid;
}

/** True for a uid this deployment may create, swap or delete: its own prefix and the catalog family. */
export function isOwnedIndexUid(uid: string, prefix: string): boolean {
  return SEARCH_INDEX_UID_PATTERN.test(uid) && uid.startsWith(`${prefix}${CATALOG_FAMILY}`);
}

/** What a live index's documents depend on besides the catalog: a different key needs a rebuild. */
export function searchRebuildKey(
  documentVersion: number,
  currency: string,
  locale: string,
): string {
  return `${documentVersion}:${currency}:${locale}`;
}

/** The stored state of one locale's index (`search_index_state`), as the decision needs it. */
export interface IndexStateFacts {
  readonly liveIndexUid: string | null;
  readonly settingsHash: string | null;
  readonly documentVersion: number | null;
  readonly currency: string | null;
  readonly rebuildRequestedAt: Date | null;
  readonly buildIndexUid: string | null;
  readonly buildStartedAt: Date | null;
}

export type IndexAction =
  | { readonly kind: "none" }
  | { readonly kind: "update_settings" }
  | { readonly kind: "continue_build" }
  | {
      readonly kind: "rebuild";
      readonly cause: "missing" | "stale_documents" | "requested" | "build_expired";
    };

/**
 * What the indexer does for one locale. A running build is continued (or restarted after 24 hours); without one, a missing
 * live index, documents built for another version or currency, or an operator's request mean a full rebuild with a swap;
 * a changed settings hash alone is applied to the live index in place (the engine re-indexes in the background and
 * search keeps working).
 */
export function decideIndexAction(input: {
  readonly locale: string;
  readonly state: IndexStateFacts | null;
  readonly derived: { readonly settingsHash: string; readonly rebuildKey: string };
  readonly now: Date;
}): IndexAction {
  const { state, derived, now } = input;
  if (state !== null && state.buildIndexUid !== null) {
    const startedAt = state.buildStartedAt?.getTime() ?? 0;
    if (now.getTime() - startedAt > SEARCH_INDEXING.buildMaxAgeHours * 3_600_000) {
      return { kind: "rebuild", cause: "build_expired" };
    }
    return { kind: "continue_build" };
  }
  if (state === null || state.liveIndexUid === null) {
    return { kind: "rebuild", cause: "missing" };
  }
  const storedKey =
    state.documentVersion === null || state.currency === null
      ? null
      : searchRebuildKey(state.documentVersion, state.currency, input.locale);
  if (storedKey !== derived.rebuildKey) {
    return { kind: "rebuild", cause: "stale_documents" };
  }
  if (state.rebuildRequestedAt !== null) {
    return { kind: "rebuild", cause: "requested" };
  }
  if (state.settingsHash !== derived.settingsHash) {
    return { kind: "update_settings" };
  }
  return { kind: "none" };
}

export const SYNONYM_LIMITS = Object.freeze({ minTerms: 2, maxTerms: 20, maxTermLength: 50 });

/**
 * Words of one synonym term: Meilisearch applies multi-word synonyms of at most three words and silently ignores longer
 * ones (review F4, ADR 0036). Not a database check (`SYNONYM_LIMITS` mirrors those): an engine limit, enforced here.
 */
export const SYNONYM_MAX_TERM_WORDS = 3;

export type SynonymTermsError =
  "not_a_list" | "invalid_term" | "too_few_terms" | "too_many_terms" | "duplicate_terms";

export type SynonymTermsResult =
  | { readonly ok: true; readonly terms: readonly string[] }
  | { readonly ok: false; readonly reason: SynonymTermsError };

/**
 * The terms of a synonym group (ADR 0034 decision 8), normalized exactly like query words so a term matches what a
 * shopper types: 2 to 20 distinct terms of 1 to 50 characters and 1 to 3 words, no control characters.
 */
export function parseSynonymTerms(raw: unknown): SynonymTermsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "not_a_list" };
  }
  if (raw.length > SYNONYM_LIMITS.maxTerms) {
    return { ok: false, reason: "too_many_terms" };
  }
  const terms: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || hasControlCharacter(entry)) {
      return { ok: false, reason: "invalid_term" };
    }
    const term = normalizeSearchWords(entry).join(" ");
    if (
      term === "" ||
      [...term].length > SYNONYM_LIMITS.maxTermLength ||
      term.split(" ").length > SYNONYM_MAX_TERM_WORDS
    ) {
      return { ok: false, reason: "invalid_term" };
    }
    if (terms.includes(term)) {
      return { ok: false, reason: "duplicate_terms" };
    }
    terms.push(term);
  }
  if (terms.length < SYNONYM_LIMITS.minTerms) {
    return { ok: false, reason: "too_few_terms" };
  }
  return { ok: true, terms };
}
