import { describe, expect, it } from "vitest";
import { ActionButton } from "./action-button";
import { classTokens, first, render, tags } from "./test-helpers";

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

    it(`renders the ${state} state without label clipping by default`, () => {
      const markup = render(
        <ActionButton state={state} idleLabel="Add" loadingLabel="Adding" doneLabel="Added" />,
      );
      expect(classTokens(markup).some((token) => /truncate|overflow/.test(token))).toBe(false);
      expect(tags(markup, "span").filter((tag) => tag.attributes.class === "min-w-0")).toEqual([]);
      expect(markup).toContain('class="grid grid-cols-1 min-w-0 max-w-full"');
    });

    it(`clips every label in the ${state} state only when opted in`, () => {
      const markup = render(
        <ActionButton
          state={state}
          idleLabel="Add"
          loadingLabel="Adding"
          doneLabel="Added"
          truncateLabels
        />,
      );
      for (const label of ["Add", "Adding", "Added"]) {
        expect(markup).toContain(`<span class="min-w-0 truncate">${label}</span>`);
      }
      expect(markup).not.toContain("truncateLabels");
    });
  }
});
