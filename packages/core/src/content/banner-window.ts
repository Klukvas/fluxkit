import { BANNER_WINDOW_BOUNDS, MAX_STORE_BANNERS, type BannerState } from "./limits.js";

/** When a banner may be shown: the active flag and the half-open window `[startsAt, endsAt)`; `null` is an open bound. */
export interface BannerSchedule {
  readonly isActive: boolean;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

export interface BannerWindowError {
  readonly path: "startsAt" | "endsAt";
  readonly code: "out_of_range" | "invalid_window";
}

function inBounds(instant: Date): boolean {
  const time = instant.getTime();
  return (
    !Number.isNaN(time) &&
    time >= BANNER_WINDOW_BOUNDS.min &&
    time < BANNER_WINDOW_BOUNDS.maxExclusive
  );
}

/**
 * Field errors of a start and end instant: each within [2000-01-01, 2200-01-01) (`out_of_range`), and the end after the
 * start when both are set (`invalid_window` at `endsAt`). Empty array = valid.
 */
export function checkBannerWindow(startsAt: Date | null, endsAt: Date | null): BannerWindowError[] {
  const errors: BannerWindowError[] = [];
  if (startsAt !== null && !inBounds(startsAt)) {
    errors.push({ path: "startsAt", code: "out_of_range" });
  }
  if (endsAt !== null && !inBounds(endsAt)) {
    errors.push({ path: "endsAt", code: "out_of_range" });
  }
  if (
    errors.length === 0 &&
    startsAt !== null &&
    endsAt !== null &&
    endsAt.getTime() <= startsAt.getTime()
  ) {
    errors.push({ path: "endsAt", code: "invalid_window" });
  }
  return errors;
}

/**
 * The state of a banner at `now`: `inactive` when switched off (whatever the window), else `scheduled` before
 * `startsAt`, `expired` from `endsAt` on, otherwise `live`. Throws a `RangeError` for an end not after the start, which
 * the API refuses and the database forbids (CHECK `banner_window_check`).
 */
export function bannerWindowState(now: Date, banner: BannerSchedule): BannerState {
  const { startsAt, endsAt } = banner;
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw new RangeError("A banner window must end after it starts.");
  }
  if (!banner.isActive) {
    return "inactive";
  }
  if (startsAt !== null && now.getTime() < startsAt.getTime()) {
    return "scheduled";
  }
  if (endsAt !== null && now.getTime() >= endsAt.getTime()) {
    return "expired";
  }
  return "live";
}

export function isBannerLive(now: Date, banner: BannerSchedule): boolean {
  return bannerWindowState(now, banner) === "live";
}

/**
 * The banners the storefront shows at `now`: live ones only, by `position` then `id`, at most `limit` (default
 * `MAX_STORE_BANNERS`). Does not change `rows`.
 */
export function selectLiveBanners<T extends BannerSchedule & { position: number; id: string }>(
  rows: readonly T[],
  now: Date,
  limit: number = MAX_STORE_BANNERS,
): T[] {
  if (limit <= 0) {
    return [];
  }
  return rows
    .filter((row) => isBannerLive(now, row))
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}
