/** Releases a slot; a second call does nothing. */
export type ReleaseSlot = () => void;

/**
 * An in-process semaphore: at most `size` uploads are decoded and re-encoded at once (ADR 0028 decision 3, memory and CPU
 * bound). A caller waits at most `waitMs` in arrival order; `undefined` means "still busy", which the route answers with
 * `429` and `Retry-After`. Per process only, like the rate limits.
 */
export class ProcessingSlots {
  private used = 0;
  private readonly queue: { grant: (release: ReleaseSlot) => void }[] = [];

  constructor(
    private readonly size: number,
    private readonly waitMs: number,
  ) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError("The number of processing slots must be an integer of at least 1");
    }
    if (!Number.isFinite(waitMs) || waitMs < 0) {
      throw new RangeError("The slot wait must be a number of milliseconds of at least 0");
    }
  }

  get inUse(): number {
    return this.used;
  }

  get waiting(): number {
    return this.queue.length;
  }

  acquire(): Promise<ReleaseSlot | undefined> {
    if (this.used < this.size) {
      this.used += 1;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve) => {
      const waiter = {
        grant: (release: ReleaseSlot) => {
          clearTimeout(timer);
          resolve(release);
        },
      };
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(waiter);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        resolve(undefined);
      }, this.waitMs);
      this.queue.push(waiter);
    });
  }

  private releaser(): ReleaseSlot {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.queue.shift();
      if (next === undefined) {
        this.used -= 1;
      } else {
        // The slot passes straight to the first waiter; the count stays the same.
        next.grant(this.releaser());
      }
    };
  }
}
