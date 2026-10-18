import { DEFAULT_SCHEDULER_INTERVAL_SECONDS } from "@fluxkit/config";

export const SCHEDULER_CONFIG = Symbol("SCHEDULER_CONFIG");

/** The scheduler lock and the event leases live on their own connections (never the pool's), so they need the URL. */
export const SCHEDULER_DATABASE_URL = Symbol("SCHEDULER_DATABASE_URL");

/** From `SCHEDULER_ENABLED` and `SCHEDULER_INTERVAL_SECONDS` (docs/contracts/config.md). */
export interface SchedulerConfig {
  /** Whether this process starts the timer. The jobs themselves can always be run by hand (`pnpm jobs:run-once`). */
  enabled: boolean;
  /** Seconds between ticks (10 to 3600). */
  intervalSeconds: number;
}

/**
 * Off for a caller that builds the application without an environment (tests, the OpenAPI export, the seed and admin
 * commands): none of them may start a timer. The API process gets its value from `SCHEDULER_ENABLED`, which defaults to true.
 */
export const DISABLED_SCHEDULER_CONFIG: Readonly<SchedulerConfig> = Object.freeze({
  enabled: false,
  intervalSeconds: DEFAULT_SCHEDULER_INTERVAL_SECONDS,
});
