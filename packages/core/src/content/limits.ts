/**
 * Home banner limits and enumerations (ADR 0046, plan 2026-11-05-admin-home-banners.md D2). The API enforces them; the
 * database repeats the layout and tone lists as CHECK constraints (`apps/api/src/database/schema/banners.ts`).
 */
export const BANNER_LIMITS = Object.freeze({
  /** Rows stored, scheduled and inactive ones included; the admin list needs no paging. */
  maxStored: 50,
  /** Banners the storefront shows at once (the storefront's `MAX_BANNERS`). */
  maxShown: 3,
  titleMaxLength: 80,
  textMaxLength: 200,
  imageAltMaxLength: 150,
  linkMaxLength: 2048,
});

/** At most this many live banners are returned by `GET /store/banners`. */
export const MAX_STORE_BANNERS = BANNER_LIMITS.maxShown;

/** At most this many banners are stored; the next create answers `409 rule_violation` `too_many_banners`. */
export const MAX_STORED_BANNERS = BANNER_LIMITS.maxStored;

/** `card`: picture, title, text and link. `image`: a finished picture with its description and link, nothing else. */
export const BANNER_LAYOUTS = ["card", "image"] as const;
export type BannerLayout = (typeof BANNER_LAYOUTS)[number];

export const BANNER_TONES = ["surface", "accent"] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

/** What the admin list shows per banner; only `live` banners can reach the storefront. */
export const BANNER_STATES = ["live", "scheduled", "expired", "inactive"] as const;
export type BannerState = (typeof BANNER_STATES)[number];

/** Start and end instants must lie in [2000-01-01, 2200-01-01) UTC, like the audit filters. */
export const BANNER_WINDOW_BOUNDS = Object.freeze({
  min: Date.UTC(2000, 0, 1),
  maxExclusive: Date.UTC(2200, 0, 1),
});
