/**
 * Remembers what one attempt proposed (generated slugs and SKUs), so a retry loop can tell a lost race, where the
 * next attempt reads fresh data and proposes something else, from a collision that retrying cannot change.
 */
export class ProposalLog {
  private current: string[] = [];
  private previous: string | undefined;

  record(...proposals: string[]): void {
    this.current.push(...proposals);
  }

  /** Closes the attempt; true when it proposed exactly what the attempt before it proposed. */
  endRoundRepeatsPrevious(): boolean {
    const key = this.current.length === 0 ? undefined : JSON.stringify(this.current);
    const repeated = key !== undefined && key === this.previous;
    this.previous = key;
    this.current = [];
    return repeated;
  }
}

export interface RetryLostRacesOptions {
  /** A concurrent write can win only so often; this stops a pathological loop. */
  maxAttempts: number;
  /** True only for a unique violation on a value the service proposed. Anything else is rethrown at once. */
  isLostRace: (error: unknown) => boolean;
  /** The error to throw (a 409) when the attempts ran out or a retry would repeat identical work. */
  exhausted: () => unknown;
}

/**
 * Runs `work` (one whole transaction) again when a proposed slug or SKU lost a race. `work` records its proposals
 * in the log. Stops with `exhausted()` when an attempt proposes what the previous one did: the data it read did not
 * change, so another round would fail the same way.
 */
export async function retryLostRaces<T>(
  options: RetryLostRacesOptions,
  work: (log: ProposalLog) => Promise<T>,
): Promise<T> {
  const log = new ProposalLog();
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await work(log);
    } catch (error) {
      if (!options.isLostRace(error)) {
        throw error;
      }
      if (log.endRoundRepeatsPrevious()) {
        break;
      }
    }
  }
  throw options.exhausted();
}
