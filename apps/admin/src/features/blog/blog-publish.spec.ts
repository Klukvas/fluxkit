import { describe, expect, it } from "vitest";
import {
  blogListHref,
  offsetOfPage,
  pageOfOffset,
  readBlogListQuery,
  writeBlogListQuery,
} from "./blog-paths";
import {
  PUBLISH_WITH_STORED_DATE,
  publishActions,
  publishNowBody,
  scheduleBody,
} from "./blog-publish";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");

describe("the publish actions of a post", () => {
  it("offers what each state allows", () => {
    expect(publishActions({ state: "draft", publishedAt: null })).toEqual([
      "publishNow",
      "schedule",
    ]);
    expect(publishActions({ state: "draft", publishedAt: "2026-10-01T08:00:00.000Z" })).toEqual([
      "publishWithDate",
      "publishNow",
      "schedule",
    ]);
    expect(publishActions({ state: "scheduled", publishedAt: "2026-12-01T08:00:00.000Z" })).toEqual(
      ["publishNow", "schedule", "unpublish"],
    );
    expect(publishActions({ state: "published", publishedAt: "2026-10-01T08:00:00.000Z" })).toEqual(
      ["unpublish"],
    );
  });

  it("publishes now with the server's clock when there is no stored date, else with this moment", () => {
    expect(publishNowBody({ publishedAt: null }, NOW)).toEqual({});
    // A scheduled post (or one unpublished earlier) would keep its stored date without one.
    expect(publishNowBody({ publishedAt: "2026-12-01T08:00:00.000Z" }, NOW)).toEqual({
      publishedAt: "2026-11-13T12:00:00.000Z",
    });
    expect(PUBLISH_WITH_STORED_DATE).toEqual({});
  });

  it("turns the chosen local time into a UTC instant, scheduled when it is ahead", () => {
    expect(scheduleBody("2026-12-01T10:30", "Europe/Kyiv", NOW)).toEqual({
      ok: true,
      body: { publishedAt: "2026-12-01T08:30:00.000Z" },
      future: true,
    });
    expect(scheduleBody("2026-01-01T00:00", "UTC", NOW)).toEqual({
      ok: true,
      body: { publishedAt: "2026-01-01T00:00:00.000Z" },
      future: false,
    });
  });

  it("refuses an empty, malformed or out-of-range time before anything is sent", () => {
    expect(scheduleBody("", "UTC", NOW)).toEqual({ ok: false, reason: "required" });
    expect(scheduleBody("2026-13-01T00:00", "UTC", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(scheduleBody("1999-12-31T23:59", "UTC", NOW)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
    expect(scheduleBody("2200-01-01T00:00", "UTC", NOW)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
    expect(scheduleBody("2199-12-31T23:59", "UTC", NOW).ok).toBe(true);
  });
});

describe("the list's address", () => {
  it("reads the state filter and the page, ignoring a bad value", () => {
    expect(readBlogListQuery(new URLSearchParams("status=scheduled&page=3"))).toEqual({
      status: "scheduled",
      page: 3,
    });
    expect(readBlogListQuery(new URLSearchParams("status=gone&page=-1"))).toEqual({ page: 1 });
    expect(readBlogListQuery(new URLSearchParams("page=1e3"))).toEqual({ page: 1 });
    // Past the API's offset cap (10 000 at 50 a page) the first page is shown instead of a refusal.
    expect(readBlogListQuery(new URLSearchParams("page=201"))).toEqual({ page: 201 });
    expect(readBlogListQuery(new URLSearchParams("page=202"))).toEqual({ page: 1 });
  });

  it("writes the bare path for the unfiltered first page", () => {
    expect(writeBlogListQuery({ page: 1 })).toBe("");
    expect(blogListHref({ status: "draft", page: 2 })).toBe("/features/blog?status=draft&page=2");
  });

  it("converts between the pager's offsets and the API's pages", () => {
    expect(offsetOfPage(1)).toBe(0);
    expect(offsetOfPage(3)).toBe(100);
    expect(pageOfOffset(0)).toBe(1);
    expect(pageOfOffset(100)).toBe(3);
  });
});
