import { describe, expect, it } from "vitest";
import {
  closedCombobox,
  comboboxKey,
  comboboxReducer,
  optionId,
  type ComboboxState,
} from "./combobox-model";

const open = (activeIndex: number): ComboboxState => ({ open: true, activeIndex });

describe("combobox keyboard behaviour", () => {
  it("ArrowDown opens a closed list on the first option and cancels the page scroll", () => {
    expect(comboboxKey(closedCombobox, "ArrowDown", 3)).toEqual({
      state: open(0),
      select: null,
      preventDefault: true,
    });
  });

  it("ArrowDown moves down and wraps from the last option to the first", () => {
    expect(comboboxKey(open(0), "ArrowDown", 3).state).toEqual(open(1));
    expect(comboboxKey(open(2), "ArrowDown", 3).state).toEqual(open(0));
    expect(comboboxKey(open(-1), "ArrowDown", 3).state).toEqual(open(0));
  });

  it("ArrowUp opens on the last option, moves up and wraps from the first to the last", () => {
    expect(comboboxKey(closedCombobox, "ArrowUp", 3).state).toEqual(open(2));
    expect(comboboxKey(open(2), "ArrowUp", 3).state).toEqual(open(1));
    expect(comboboxKey(open(0), "ArrowUp", 3).state).toEqual(open(2));
    expect(comboboxKey(open(-1), "ArrowUp", 3).state).toEqual(open(2));
  });

  it("arrows with no options open an empty list and highlight nothing", () => {
    expect(comboboxKey(closedCombobox, "ArrowDown", 0).state).toEqual(open(-1));
    expect(comboboxKey(open(-1), "ArrowDown", 0)).toMatchObject({
      state: open(-1),
      preventDefault: true,
    });
    expect(comboboxKey(open(-1), "ArrowUp", 0).state).toEqual(open(-1));
  });

  it("Enter accepts the highlighted option, closes the list and does not submit the form", () => {
    expect(comboboxKey(open(1), "Enter", 3)).toEqual({
      state: closedCombobox,
      select: 1,
      preventDefault: true,
    });
  });

  it("Enter with the list open and nothing highlighted does not submit the form either", () => {
    expect(comboboxKey(open(-1), "Enter", 3)).toEqual({
      state: open(-1),
      select: null,
      preventDefault: true,
    });
  });

  it("Enter with the list closed is left alone (the form may submit)", () => {
    expect(comboboxKey(closedCombobox, "Enter", 3)).toEqual({
      state: closedCombobox,
      select: null,
      preventDefault: false,
    });
  });

  it("Enter never accepts an index beyond the list (options changed under the highlight)", () => {
    expect(comboboxKey(open(5), "Enter", 3).select).toBeNull();
  });

  it("Escape closes an open list and is left alone when it is closed", () => {
    expect(comboboxKey(open(1), "Escape", 3)).toEqual({
      state: closedCombobox,
      select: null,
      preventDefault: true,
    });
    expect(comboboxKey(closedCombobox, "Escape", 3).preventDefault).toBe(false);
  });

  it("Tab closes the list but never cancels the move: no keyboard trap", () => {
    expect(comboboxKey(open(1), "Tab", 3)).toEqual({
      state: closedCombobox,
      select: null,
      preventDefault: false,
    });
    expect(comboboxKey(closedCombobox, "Tab", 3).preventDefault).toBe(false);
  });

  it("leaves Home, End, printable keys and the rest to the text box", () => {
    for (const key of ["Home", "End", "a", "Backspace", " ", "ArrowLeft", "ArrowRight"]) {
      expect(comboboxKey(open(1), key, 3)).toEqual({
        state: open(1),
        select: null,
        preventDefault: false,
      });
    }
  });
});

describe("combobox reducer", () => {
  it("typing opens the list with nothing highlighted", () => {
    expect(comboboxReducer(closedCombobox, { type: "typed" })).toEqual(open(-1));
    expect(comboboxReducer(open(2), { type: "typed" })).toEqual(open(-1));
  });

  it("closing forgets the highlight; a new answer resets it", () => {
    expect(comboboxReducer(open(2), { type: "close" })).toEqual(closedCombobox);
    expect(comboboxReducer(open(2), { type: "optionsChanged" })).toEqual(open(-1));
  });

  it("returns the same object when nothing changes (no render)", () => {
    const state = open(-1);
    expect(comboboxReducer(state, { type: "typed" })).toBe(state);
    expect(comboboxReducer(closedCombobox, { type: "close" })).toBe(closedCombobox);
    expect(comboboxReducer(state, { type: "optionsChanged" })).toBe(state);
    expect(comboboxReducer(open(1), { type: "highlight", index: 1 })).toEqual(open(1));
  });

  it("applies a key through comboboxKey", () => {
    expect(comboboxReducer(closedCombobox, { type: "key", key: "ArrowDown", count: 2 })).toEqual(
      open(0),
    );
  });

  it("builds stable option ids", () => {
    expect(optionId("list", 3)).toBe("list-option-3");
  });
});
