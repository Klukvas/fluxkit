/** A resolved credential is reused only while the revision is unchanged and this age has not passed. */
export const CREDENTIAL_CACHE_MAX_AGE_MS = 5_000;

export type CacheRead<T> = { readonly hit: false } | { readonly hit: true; readonly value: T };

/**
 * One process-local snapshot keyed by the integration revision (ADR 0058). A different revision misses immediately.
 * The same revision misses once it is older than {@link CREDENTIAL_CACHE_MAX_AGE_MS}. Nothing here is written to Redis.
 */
export class RevisionCache<T> {
  private entry: { revision: number; at: number; value: T } | undefined;

  get(revision: number, now: number): CacheRead<T> {
    const entry = this.entry;
    if (entry === undefined || entry.revision !== revision) return { hit: false };
    if (now - entry.at >= CREDENTIAL_CACHE_MAX_AGE_MS) return { hit: false };
    return { hit: true, value: entry.value };
  }

  set(revision: number, now: number, value: T): void {
    this.entry = { revision, at: now, value };
  }

  clear(): void {
    this.entry = undefined;
  }
}
