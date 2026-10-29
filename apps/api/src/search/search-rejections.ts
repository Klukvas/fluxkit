/** What `GET /admin/search/status` shows about searches the engine refused (`engine.rejectedSearches`). */
export interface SearchRejectionsSnapshot {
  readonly count: number;
  readonly lastCode: string | null;
  readonly lastAt: string | null;
}

/**
 * Store searches the engine answered with HTTP 400 (`engine_rejected`) since this process started. Such a refusal is a
 * bug or a drift between the API and the live index settings, not an outage (review F1): the store answers `500`, logs
 * an error and counts it here so the admin status shows it. Per process: with several API instances each counts its own.
 */
export class SearchRejections {
  private count = 0;

  private lastCode: string | null = null;

  private lastAt: Date | null = null;

  record(engineCode: string | undefined, at: Date): void {
    this.count += 1;
    this.lastCode = engineCode ?? null;
    this.lastAt = at;
  }

  snapshot(): SearchRejectionsSnapshot {
    return {
      count: this.count,
      lastCode: this.lastCode,
      lastAt: this.lastAt === null ? null : this.lastAt.toISOString(),
    };
  }
}
