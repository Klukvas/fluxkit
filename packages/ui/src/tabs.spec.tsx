import { describe, expect, it } from "vitest";
import { Tabs } from "./tabs";
import { render, tags, text } from "./test-helpers";

const items = [
  { id: "general", label: "General" },
  { id: "prices", label: "Prices" },
  { id: "stock", label: "Stock", disabled: true },
];

const tabs = (selectedId: string, content = "Panel body"): string =>
  render(
    <Tabs label="Product sections" tabs={items} selectedId={selectedId} onChange={() => undefined}>
      {content}
    </Tabs>,
  );

describe("Tabs", () => {
  it("is a labelled tablist of buttons with role tab", () => {
    const markup = tabs("general");
    const list = tags(markup, "div").find((tag) => tag.attributes.role === "tablist");
    expect(list?.attributes["aria-label"]).toBe("Product sections");
    const buttons = tags(markup, "button");
    expect(buttons.map((tab) => tab.attributes.role)).toEqual(["tab", "tab", "tab"]);
    expect(buttons.map((tab) => tab.attributes.type)).toEqual(["button", "button", "button"]);
    expect(text(markup)).toBe("General Prices Stock Panel body");
  });

  it("marks exactly the selected tab with aria-selected and gives it the only tab stop", () => {
    const buttons = tags(tabs("prices"), "button");
    expect(buttons.map((tab) => tab.attributes["aria-selected"])).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(buttons.map((tab) => tab.attributes.tabindex)).toEqual(["-1", "0", "-1"]);
  });

  it("links the selected tab and the tabpanel both ways", () => {
    const markup = tabs("prices");
    const [, selected] = tags(markup, "button");
    const panel = tags(markup, "div").find((tag) => tag.attributes.role === "tabpanel");
    expect(panel?.attributes.id).toBeTruthy();
    expect(selected?.attributes["aria-controls"]).toBe(panel?.attributes.id);
    expect(panel?.attributes["aria-labelledby"]).toBe(selected?.attributes.id);
    expect(tags(markup, "div").filter((tag) => tag.attributes.role === "tabpanel")).toHaveLength(1);
  });

  it("does not point aria-controls at panels that are not rendered", () => {
    const buttons = tags(tabs("prices"), "button");
    expect(buttons.map((tab) => "aria-controls" in tab.attributes)).toEqual([false, true, false]);
  });

  it("gives every tab a distinct id", () => {
    const ids = tags(tabs("general"), "button").map((tab) => tab.attributes.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("disables a disabled tab", () => {
    const buttons = tags(tabs("general"), "button");
    expect(buttons.map((tab) => tab.attributes.disabled)).toEqual([undefined, undefined, true]);
  });

  it("keeps one tab stop when the selected id is unknown: the first enabled tab", () => {
    const buttons = tags(tabs("missing"), "button");
    expect(buttons.map((tab) => tab.attributes.tabindex)).toEqual(["0", "-1", "-1"]);
    expect(buttons.map((tab) => tab.attributes["aria-selected"])).toEqual([
      "false",
      "false",
      "false",
    ]);
  });

  it("makes the tabpanel focusable so keyboard users can reach its content", () => {
    const panel = tags(tabs("general"), "div").find((tag) => tag.attributes.role === "tabpanel");
    expect(panel?.attributes.tabindex).toBe("0");
  });
});
