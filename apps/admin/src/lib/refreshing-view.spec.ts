import { describe, expect, it } from "vitest";
import { refreshingFallback } from "./refreshing-view";

describe("refreshingFallback", () => {
  it("shows the data when ready", () => {
    expect(refreshingFallback({ status: "ready" }, true)).toEqual({
      fallback: null,
      refreshing: false,
    });
    expect(refreshingFallback({ status: "ready" }, false)).toEqual({
      fallback: null,
      refreshing: false,
    });
  });

  it("shows loading the first time, and keeps the previous data while a reload runs", () => {
    expect(refreshingFallback({ status: "loading" }, false)).toEqual({
      fallback: { status: "loading" },
      refreshing: false,
    });
    expect(refreshingFallback({ status: "loading" }, true)).toEqual({
      fallback: null,
      refreshing: true,
    });
  });

  it("shows a failed reload as the failure, never as stale data", () => {
    for (const status of ["error", "forbidden", "notFound"] as const) {
      expect(refreshingFallback({ status }, true)).toEqual({
        fallback: { status },
        refreshing: false,
      });
    }
  });
});
