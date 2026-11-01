/** The longest a burst of `engine_busy` refusals goes unreported in the log. */
export const BUSY_LOG_WINDOW_MS = 30_000;

/** Refusals by reason since the process started (`SearchEngine.interactiveLane().refused`). */
export interface RefusalCounts {
  readonly queueFull: number;
  readonly waitExceeded: number;
}

/**
 * The log of searches the engine client's interactive lane refused (`engine_busy`, ADR 0041 and 0042; review F4 of PR
 * 204). Under overload one line per refusal is tens of warn lines a second, so: the first refusal of a quiet period is
 * one warn line at once; later ones are summed into at most one warn line per window with the counts by reason (read
 * from the engine's counters); a window without refusals ends the period. The counters themselves are in
 * `GET /admin/search/status`. Lines carry codes, times and counts only, never a query, key or URL. Per process.
 */
export class BusyRefusalLog {
  /** The counts when the current window began; undefined in a quiet period. */
  private windowStart: RefusalCounts | undefined;

  constructor(
    private readonly logger: { warn(message: string): void },
    private readonly counts: () => RefusalCounts,
    private readonly windowMs = BUSY_LOG_WINDOW_MS,
  ) {}

  /** One refused search; `detail` is the code, the wait and the word count (never the query text). */
  refused(detail: string): void {
    if (this.windowStart !== undefined) {
      return;
    }
    this.logger.warn(
      `Search refused: ${detail}; the engine client's interactive lane is full (further refusals are summed every ${String(this.windowMs / 1000)} s; counters in GET /admin/search/status)`,
    );
    this.openWindow();
  }

  private openWindow(): void {
    this.windowStart = this.counts();
    // Unreferenced: a pending summary never keeps the process alive.
    setTimeout(() => this.closeWindow(), this.windowMs).unref();
  }

  private closeWindow(): void {
    const start = this.windowStart;
    const now = this.counts();
    this.windowStart = undefined;
    if (start === undefined) {
      return;
    }
    const queueFull = now.queueFull - start.queueFull;
    const waitExceeded = now.waitExceeded - start.waitExceeded;
    const total = queueFull + waitExceeded;
    if (total <= 0) {
      return;
    }
    this.logger.warn(
      `Search refused: ${String(total)} more ${total === 1 ? "search" : "searches"} refused in the last ${String(this.windowMs / 1000)} s (engine_busy: queue full ${String(queueFull)}, wait exceeded ${String(waitExceeded)})`,
    );
    this.openWindow();
  }
}
