import { describe, expect, it } from "vitest";
import { ActionButton } from "./action-button";
import { first, render, tags } from "./test-helpers";

describe("ActionButton", () => {
  for (const state of ["idle", "loading", "done"] as const) {
    it(`exposes only the ${state} label and reserves every label's width`, () => {
      const markup = render(
        <ActionButton
          state={state}
          idleLabel="Add"
          loadingLabel="Adding"
          doneLabel="Added"
          accessibleSuffix="Tool"
        />,
      );
      const labels = tags(markup, "span").filter((tag) =>
        String(tag.attributes.class).includes("fk-action-label"),
      );
      expect(labels).toHaveLength(3);
      expect(labels.map((tag) => tag.attributes["aria-hidden"])).toEqual(
        [state !== "idle", state !== "loading", state !== "done"].map(String),
      );
      expect(
        labels.every((tag) => String(tag.attributes.class).includes("col-start-1 row-start-1")),
      ).toBe(true);
      const button = first(markup, "button");
      expect(button.attributes["aria-busy"]).toBe(String(state === "loading"));
      expect(button.attributes["aria-disabled"]).toBe(String(state === "loading"));
      expect(button.attributes).not.toHaveProperty("disabled");
      expect(markup).toContain("Tool");
    });
  }
});
