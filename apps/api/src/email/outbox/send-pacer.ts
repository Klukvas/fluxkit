/**
 * Spaces the provider calls of one process (ADR 0031 decision 6: at most `sendsPerSecond`, under Resend's 10 requests
 * per second per team, R7): every call takes the next free slot, `1000 / sendsPerSecond` ms after the previous one, and
 * waits for it. Job 9 and the immediate attempts share one pacer, so together they never exceed the rate in one process
 * (several processes can, ADR 0031 open question 5). Reads the monotonic clock; a test passes its own clock and sleep.
 */
export class SendPacer {
  private readonly intervalMs: number;
  private nextSlotAt = Number.NEGATIVE_INFINITY;
  private waitingCount = 0;

  constructor(
    sendsPerSecond: number,
    private readonly clock: () => number = () => performance.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!Number.isFinite(sendsPerSecond) || sendsPerSecond <= 0) {
      throw new RangeError("sendsPerSecond must be a positive number");
    }
    this.intervalMs = 1000 / sendsPerSecond;
  }

  /** Calls waiting for their slot right now. */
  waiting(): number {
    return this.waitingCount;
  }

  /** Takes the next slot and resolves when it comes. Slots are handed out in call order. */
  async acquire(): Promise<void> {
    const now = this.clock();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.intervalMs;
    if (slot <= now) {
      return;
    }
    this.waitingCount += 1;
    try {
      await this.sleep(slot - now);
    } finally {
      this.waitingCount -= 1;
    }
  }
}
