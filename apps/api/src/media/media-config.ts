import {
  DEFAULT_MEDIA_MAX_BYTES,
  DEFAULT_MEDIA_MAX_PIXELS,
  type MediaStorageDriver,
} from "@fluxkit/config";

export const MEDIA_CONFIG = Symbol("MEDIA_CONFIG");

/** From the `MEDIA_*` variables (docs/contracts/config.md, ADR 0028 decision 8), plus fixed tuning. */
export interface MediaConfig {
  readonly driver: MediaStorageDriver;
  /** Absolute upload directory; set with the `local` driver. */
  readonly directory: string | undefined;
  /** Prefix of every stored upload URL, no trailing slash. Also the prefix attach marking looks for. */
  readonly publicBaseUrl: string | undefined;
  readonly maxBytes: number;
  readonly maxPixels: number;
  readonly tuning: MediaTuning;
}

/** Fixed numbers of ADR 0028 decision 3. Not configuration: tests use other ones to stay fast. */
export interface MediaTuning {
  /** Uploads decoded and re-encoded at once per process. */
  readonly processingSlots: number;
  /** How long an upload waits for a free slot before `429`. */
  readonly slotWaitMs: number;
  /** `Retry-After` of that `429`, in seconds. */
  readonly busyRetryAfterSeconds: number;
  /** Decode and re-encode budget; above it the upload is refused as `processing_timeout`. */
  readonly processingBudgetMs: number;
}

export const DEFAULT_MEDIA_TUNING: Readonly<MediaTuning> = Object.freeze({
  processingSlots: 2,
  slotWaitMs: 10_000,
  busyRetryAfterSeconds: 5,
  processingBudgetMs: 30_000,
});

/**
 * Uploads off for a caller that builds the application without an environment (tests, the OpenAPI export, the admin
 * commands): none of them may need or touch a media directory. The API process, `pnpm seed` (it uploads the demo images),
 * `pnpm jobs:run-once` and `pnpm search:reindex` pass the `MEDIA_*` values, whose default outside production is the local
 * driver.
 */
export const DISABLED_MEDIA_CONFIG: Readonly<MediaConfig> = Object.freeze({
  driver: "none",
  directory: undefined,
  publicBaseUrl: undefined,
  maxBytes: DEFAULT_MEDIA_MAX_BYTES,
  maxPixels: DEFAULT_MEDIA_MAX_PIXELS,
  tuning: DEFAULT_MEDIA_TUNING,
});
