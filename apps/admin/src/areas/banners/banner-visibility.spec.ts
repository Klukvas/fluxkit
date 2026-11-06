import { describe, expect, it } from "vitest";
import { bannerPlacement, bannerVisibility, newBannerBehindShown } from "./banner-visibility";
import { bannerFixture } from "./test-helpers";

const live = (id: string, shown: boolean) =>
  bannerFixture({ id, state: "live", shownOnStorefront: shown });
const other = (id: string, state: "scheduled" | "inactive" | "expired") =>
  bannerFixture({ id, state, isActive: state !== "inactive", shownOnStorefront: false });

describe("bannerVisibility", () => {
  it("marks the first 3 live banners shown and a live one after them live but not shown", () => {
    const banners = [live("a", true), live("b", true), live("c", true), live("d", false)];
    expect(bannerVisibility(banners, 3)).toEqual(["shown", "shown", "shown", "liveNotShown"]);
  });

  it("warns for a scheduled or switched-off banner placed after the first 3 live ones", () => {
    const banners = [
      other("s1", "scheduled"),
      live("a", true),
      live("b", true),
      other("off", "inactive"),
      live("c", true),
      other("s2", "scheduled"),
      other("off2", "inactive"),
      other("gone", "expired"),
    ];
    expect(bannerVisibility(banners, 3)).toEqual([
      "none",
      "shown",
      "shown",
      "none",
      "shown",
      "behindShown",
      "behindShown",
      "none",
    ]);
  });

  it("has nothing to say while fewer than 3 banners are live", () => {
    expect(bannerVisibility([live("a", true), other("s", "scheduled")], 3)).toEqual([
      "shown",
      "none",
    ]);
  });

  it("tells the form where a stored or a new banner stands", () => {
    const banners = [
      live("a", true),
      live("b", true),
      live("c", true),
      live("d", false),
      other("s", "scheduled"),
    ];
    expect(bannerPlacement(banners, "a", 3)).toBeNull();
    expect(bannerPlacement(banners, "d", 3)).toBe("liveNotShown");
    expect(bannerPlacement(banners, "s", 3)).toBe("behindShown");
    expect(bannerPlacement(banners, "missing", 3)).toBeNull();
    expect(bannerPlacement(banners, null, 3)).toBe("newBehindShown");
    expect(bannerPlacement([live("a", true)], null, 3)).toBeNull();
  });

  it("a new banner is added at the end: behind the shown ones once 3 are live", () => {
    expect(newBannerBehindShown([live("a", true), live("b", true)], 3)).toBe(false);
    expect(
      newBannerBehindShown([live("a", true), live("b", true), other("x", "scheduled")], 3),
    ).toBe(false);
    expect(newBannerBehindShown([live("a", true), live("b", true), live("c", true)], 3)).toBe(true);
  });
});
