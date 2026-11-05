import { describe, expect, it } from "vitest";
import {
  bannerWindowState,
  checkBannerWindow,
  isBannerLive,
  selectLiveBanners,
  type BannerSchedule,
} from "./banner-window.js";
import { MAX_STORE_BANNERS } from "./limits.js";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const ms = (offset: number) => new Date(NOW.getTime() + offset);

function schedule(changes: Partial<BannerSchedule> = {}): BannerSchedule {
  return { isActive: true, startsAt: null, endsAt: null, ...changes };
}

describe("bannerWindowState (half-open window [startsAt, endsAt), UTC instants)", () => {
  it("is live when active and both bounds are open", () => {
    expect(bannerWindowState(NOW, schedule())).toBe("live");
  });

  it("is live from the start instant itself", () => {
    expect(bannerWindowState(NOW, schedule({ startsAt: NOW }))).toBe("live");
    expect(bannerWindowState(NOW, schedule({ startsAt: ms(1) }))).toBe("scheduled");
    expect(bannerWindowState(NOW, schedule({ startsAt: ms(-1) }))).toBe("live");
  });

  it("is no longer live at the end instant itself", () => {
    expect(bannerWindowState(NOW, schedule({ endsAt: NOW }))).toBe("expired");
    expect(bannerWindowState(NOW, schedule({ endsAt: ms(1) }))).toBe("live");
    expect(bannerWindowState(NOW, schedule({ endsAt: ms(-1) }))).toBe("expired");
  });

  it("is live inside a closed window and outside it scheduled or expired", () => {
    const window = { startsAt: ms(-1000), endsAt: ms(1000) };
    expect(bannerWindowState(NOW, schedule(window))).toBe("live");
    expect(bannerWindowState(ms(-1001), schedule(window))).toBe("scheduled");
    expect(bannerWindowState(ms(1000), schedule(window))).toBe("expired");
  });

  it("reports inactive whatever the window says (inactive wins)", () => {
    for (const window of [
      {},
      { startsAt: ms(1) },
      { endsAt: ms(-1) },
      { startsAt: ms(-1), endsAt: ms(1) },
    ]) {
      expect(bannerWindowState(NOW, schedule({ ...window, isActive: false }))).toBe("inactive");
    }
  });

  it("refuses a window whose end is not after its start (the database forbids it)", () => {
    expect(() => bannerWindowState(NOW, schedule({ startsAt: NOW, endsAt: NOW }))).toThrow(
      RangeError,
    );
    expect(() => bannerWindowState(NOW, schedule({ startsAt: ms(1), endsAt: ms(-1) }))).toThrow(
      RangeError,
    );
    expect(() =>
      bannerWindowState(NOW, schedule({ isActive: false, startsAt: NOW, endsAt: NOW })),
    ).toThrow(RangeError);
  });

  it("isBannerLive is true for the live state only", () => {
    expect(isBannerLive(NOW, schedule())).toBe(true);
    expect(isBannerLive(NOW, schedule({ isActive: false }))).toBe(false);
    expect(isBannerLive(NOW, schedule({ startsAt: ms(1) }))).toBe(false);
    expect(isBannerLive(NOW, schedule({ endsAt: NOW }))).toBe(false);
  });
});

describe("checkBannerWindow", () => {
  it("accepts open bounds and an end after the start", () => {
    expect(checkBannerWindow(null, null)).toEqual([]);
    expect(checkBannerWindow(NOW, null)).toEqual([]);
    expect(checkBannerWindow(null, NOW)).toEqual([]);
    expect(checkBannerWindow(NOW, ms(1))).toEqual([]);
  });

  it("refuses an end at or before the start, at endsAt", () => {
    expect(checkBannerWindow(NOW, NOW)).toEqual([{ path: "endsAt", code: "invalid_window" }]);
    expect(checkBannerWindow(NOW, ms(-1))).toEqual([{ path: "endsAt", code: "invalid_window" }]);
  });

  it("refuses instants before 2000-01-01 or from 2200-01-01 on", () => {
    const min = new Date("2000-01-01T00:00:00.000Z");
    const max = new Date("2200-01-01T00:00:00.000Z");
    expect(checkBannerWindow(min, new Date(max.getTime() - 1))).toEqual([]);
    expect(checkBannerWindow(new Date(min.getTime() - 1), null)).toEqual([
      { path: "startsAt", code: "out_of_range" },
    ]);
    expect(checkBannerWindow(null, max)).toEqual([{ path: "endsAt", code: "out_of_range" }]);
    expect(checkBannerWindow(new Date(Number.NaN), null)).toEqual([
      { path: "startsAt", code: "out_of_range" },
    ]);
  });
});

describe("selectLiveBanners", () => {
  interface Row extends BannerSchedule {
    id: string;
    position: number;
  }
  const row = (id: string, position: number, changes: Partial<BannerSchedule> = {}): Row => ({
    id,
    position,
    ...schedule(changes),
  });

  it("keeps only live rows, ordered by position, then id", () => {
    const rows = [
      row("b", 2),
      row("off", 0, { isActive: false }),
      row("later", 1, { startsAt: ms(1) }),
      row("gone", 1, { endsAt: NOW }),
      row("c", 1),
      row("a", 2),
    ];
    expect(selectLiveBanners(rows, NOW).map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });

  it(`caps the result at MAX_STORE_BANNERS (${MAX_STORE_BANNERS}) by default, the 4th live one is hidden`, () => {
    expect(MAX_STORE_BANNERS).toBe(3);
    const rows = [row("d", 3), row("c", 2), row("b", 1), row("a", 0)];
    expect(selectLiveBanners(rows, NOW).map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(selectLiveBanners(rows, NOW, 1).map(({ id }) => id)).toEqual(["a"]);
  });

  it("fills the cap with later live rows when earlier ones are not live", () => {
    const rows = [
      row("a", 0, { isActive: false }),
      row("b", 1, { endsAt: ms(-1) }),
      row("c", 2),
      row("d", 3),
      row("e", 4),
      row("f", 5),
    ];
    expect(selectLiveBanners(rows, NOW).map(({ id }) => id)).toEqual(["c", "d", "e"]);
  });

  it("does not reorder or change its input", () => {
    const rows = Object.freeze([row("b", 1), row("a", 0)]);
    expect(selectLiveBanners(rows, NOW).map(({ id }) => id)).toEqual(["a", "b"]);
    expect(rows.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("returns nothing for no rows or a non-positive cap", () => {
    expect(selectLiveBanners([], NOW)).toEqual([]);
    expect(selectLiveBanners([row("a", 0)], NOW, 0)).toEqual([]);
  });
});
