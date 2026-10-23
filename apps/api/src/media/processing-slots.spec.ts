import { describe, expect, it } from "vitest";
import { ProcessingSlots } from "./processing-slots.js";

describe("ProcessingSlots (at most N uploads processed at once, ADR 0028 decision 3)", () => {
  it("hands out the configured number of slots at once", async () => {
    const slots = new ProcessingSlots(2, 1000);
    const first = await slots.acquire();
    const second = await slots.acquire();
    expect(first).toBeTypeOf("function");
    expect(second).toBeTypeOf("function");
    expect(slots.inUse).toBe(2);
  });

  it("makes the next caller wait, and gives up after the wait limit (undefined = answer 429)", async () => {
    const slots = new ProcessingSlots(2, 50);
    await slots.acquire();
    await slots.acquire();
    const started = Date.now();
    expect(await slots.acquire()).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(slots.inUse).toBe(2);
    expect(slots.waiting).toBe(0);
  });

  it("passes a released slot to the first waiter", async () => {
    const slots = new ProcessingSlots(1, 1000);
    const release = await slots.acquire();
    const order: string[] = [];
    const waiterA = slots.acquire().then((granted) => {
      order.push("a");
      return granted;
    });
    const waiterB = slots.acquire().then((granted) => {
      order.push("b");
      return granted;
    });
    expect(slots.waiting).toBe(2);
    release?.();
    const releaseA = await waiterA;
    expect(order).toEqual(["a"]);
    expect(slots.inUse).toBe(1);
    releaseA?.();
    await waiterB;
    expect(order).toEqual(["a", "b"]);
  });

  it("ignores a second release of the same slot (it cannot free a slot it does not hold)", async () => {
    const slots = new ProcessingSlots(1, 30);
    const release = await slots.acquire();
    release?.();
    release?.();
    expect(slots.inUse).toBe(0);
    const again = await slots.acquire();
    expect(again).toBeTypeOf("function");
    expect(await slots.acquire()).toBeUndefined();
  });

  it("refuses nonsense numbers", () => {
    expect(() => new ProcessingSlots(0, 10)).toThrow(RangeError);
    expect(() => new ProcessingSlots(1.5, 10)).toThrow(RangeError);
    expect(() => new ProcessingSlots(1, -1)).toThrow(RangeError);
  });
});
