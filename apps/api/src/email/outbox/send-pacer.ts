import type { WindowStore } from "../../rate-limit/window-store.js";

/** Redis TIME is rounded down to milliseconds; reserve that rounding error as well as allowed lateness. */
const SLOT_TOLERANCE_MS = 5;

/** One admission queue for job and immediate calls; never catch up missed slots (ADR 0031, 0055). */
export class SendPacer {
  private readonly intervalMs: number;
  private nextSlotAt = Number.NEGATIVE_INFINITY;
  private waitingCount = 0;
  private replyAllowanceMs = 0;
  private admissions: Promise<void> = Promise.resolve();

  constructor(
    sendsPerSecond: number,
    private readonly clock: () => number = () => performance.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly store?: WindowStore,
  ) {
    if (!Number.isFinite(sendsPerSecond) || sendsPerSecond <= 0) {
      throw new RangeError("sendsPerSecond must be a positive number");
    }
    this.intervalMs = 1000 / sendsPerSecond;
  }

  waiting(): number {
    return this.waitingCount;
  }

  async acquire(maxWaitMs = 110_000): Promise<boolean> {
    return (await this.start(maxWaitMs, () => undefined)).started;
  }

  /**
   * Serializes slot admission and synchronous provider invocation, never database I/O or provider completion.
   * The wait budget includes queued admissions, Redis round trips and sleeps.
   */
  async start<T>(
    maxWaitMs: number,
    start: () => T,
  ): Promise<{ started: false } | { started: true; value: T }> {
    const until = this.clock() + Math.max(0, maxWaitMs);
    this.waitingCount += 1;
    const admission = this.admissions.then(async () => {
      for (;;) {
        if (this.clock() >= until) return { started: false } as const;
        const localWait = Math.max(0, this.nextSlotAt - this.clock());
        if (this.clock() + localWait >= until) return { started: false } as const;
        await this.waitUntil(this.clock() + localWait);
        if (this.clock() >= until) return { started: false } as const;
        const requestedAt = this.clock();
        const replyAllowance = this.replyAllowanceMs;
        const shared = await this.store?.reserveEmailSlot?.(
          this.intervalMs + replyAllowance + SLOT_TOLERANCE_MS + 1,
          until - requestedAt,
        );
        const receivedAt = this.clock();
        const replyMs = Math.ceil(receivedAt - requestedAt);
        const slot = receivedAt + (shared?.waitMs ?? 0);
        // The server reserved between request and reply. Sleeping the returned wait from receipt never starts
        // early. Pad this reservation's interval for reply uncertainty, separately from the 5 ms timer tolerance.
        const latest = requestedAt + (shared?.waitMs ?? 0) + replyAllowance + SLOT_TOLERANCE_MS;
        if (slot >= until) return { started: false } as const;
        if (shared != null && slot > latest) {
          // This reservation did not include enough reply padding. Leave it unused and reserve with the observed RTT.
          this.replyAllowanceMs = replyMs;
          continue;
        }
        await this.waitUntil(slot);
        if (this.clock() >= until) return { started: false } as const;
        if (shared != null && (this.clock() > latest || this.clock() > slot + SLOT_TOLERANCE_MS))
          continue;
        if (shared != null) this.replyAllowanceMs = replyMs;
        this.nextSlotAt = this.clock() + this.intervalMs;
        return { started: true, value: start() } as const;
      }
    });
    this.admissions = admission.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await admission;
    } finally {
      this.waitingCount -= 1;
    }
  }

  private async waitUntil(at: number): Promise<void> {
    let remaining = at - this.clock();
    while (remaining > 0) {
      await this.sleep(Math.min(remaining, 2_147_483_647));
      remaining = at - this.clock();
    }
  }
}
