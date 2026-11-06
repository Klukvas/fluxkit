import type { AdminHomeBanner } from "@fluxkit/api-client";

/**
 * What the storefront makes of a banner's place in the list (`GET /store/banners`: the first `maxShown` live banners, by
 * position):
 * - `shown`: on the home page now (the API's `shownOnStorefront`);
 * - `liveNotShown`: live, but after the first `maxShown` live ones, so not on the home page;
 * - `behindShown`: scheduled or switched off and placed after the first `maxShown` live ones: when it goes live it still
 *   does not appear until it is moved up (or a banner ahead of it ends);
 * - `none`: nothing to point out (ended, or ahead of the shown ones).
 */
export type BannerVisibility = "shown" | "liveNotShown" | "behindShown" | "none";

type ListedBanner = Pick<AdminHomeBanner, "state" | "shownOnStorefront">;

/** The visibility of each banner of a list in storefront order (the list of `GET /admin/banners`). */
export function bannerVisibility(
  banners: readonly ListedBanner[],
  maxShown: number,
): BannerVisibility[] {
  let liveAhead = 0;
  return banners.map((banner) => {
    const behind = liveAhead >= maxShown;
    if (banner.state === "live") {
      liveAhead += 1;
      return banner.shownOnStorefront ? "shown" : "liveNotShown";
    }
    if ((banner.state === "scheduled" || banner.state === "inactive") && behind) {
      return "behindShown";
    }
    return "none";
  });
}

/** A new banner is appended at the end (`POST /admin/banners`): behind the shown ones once `maxShown` banners are live. */
export function newBannerBehindShown(banners: readonly ListedBanner[], maxShown: number): boolean {
  return banners.filter((banner) => banner.state === "live").length >= maxShown;
}

/** What the form says about the banner's place: a stored banner by its id, a new one (`id` `null`) at the end. */
export type BannerPlacement = "liveNotShown" | "behindShown" | "newBehindShown";

export function bannerPlacement(
  banners: readonly (ListedBanner & Pick<AdminHomeBanner, "id">)[],
  id: string | null,
  maxShown: number,
): BannerPlacement | null {
  if (id === null) return newBannerBehindShown(banners, maxShown) ? "newBehindShown" : null;
  const index = banners.findIndex((banner) => banner.id === id);
  if (index === -1) return null;
  const visibility = bannerVisibility(banners, maxShown)[index];
  return visibility === "liveNotShown" || visibility === "behindShown" ? visibility : null;
}
