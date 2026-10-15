export const CLOCK = Symbol("CLOCK");

/** The time source of auth code, so tests can control it. Production uses the system clock. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
