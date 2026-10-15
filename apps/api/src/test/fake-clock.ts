import type { Clock } from "../auth/clock.js";

/** TEST ONLY. A clock that stands still until the test moves it. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = "2030-01-01T00:00:00.000Z") {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(time: Date | string): void {
    this.current = new Date(time);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
