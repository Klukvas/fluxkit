import { describe, expect, it } from "vitest";
import {
  enabledSlices,
  featureRouteGate,
  shownFeatures,
  type EnabledFeatures,
} from "./enabled-features";

const ready = (names: string[]): EnabledFeatures => ({ status: "ready", names });

describe("enabled feature slices (ADR 0049, E8)", () => {
  it("shows a slice only when the API lists its feature, in the build's order", () => {
    expect(enabledSlices(["example", "blog"], ["blog"])).toEqual(["blog"]);
    expect(enabledSlices(["example"], ["blog"])).toEqual([]);
    expect(enabledSlices([], ["blog", "notes"])).toEqual([]);
    expect(enabledSlices(["notes", "blog"], ["blog", "notes"])).toEqual(["blog", "notes"]);
  });

  it("gives the navigation no feature while the answer is unknown or failed", () => {
    expect(shownFeatures({ status: "none" })).toEqual([]);
    expect(shownFeatures({ status: "loading" })).toEqual([]);
    expect(shownFeatures({ status: "failed", failure: { kind: "network" } })).toEqual([]);
    expect(shownFeatures(ready(["blog"]))).toEqual(["blog"]);
  });

  it("holds a feature screen back until its feature is known to be enabled", () => {
    expect(featureRouteGate(undefined, { status: "loading" })).toBeNull();
    expect(featureRouteGate("blog", { status: "none" })).toBe("notFound");
    expect(featureRouteGate("blog", { status: "loading" })).toBe("loading");
    expect(featureRouteGate("blog", { status: "failed", failure: { kind: "timeout" } })).toBe(
      "failed",
    );
    expect(featureRouteGate("blog", ready([]))).toBe("notFound");
    expect(featureRouteGate("blog", ready(["notes"]))).toBe("notFound");
    expect(featureRouteGate("blog", ready(["blog"]))).toBe("open");
  });
});
