import { CATALOG_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  PICKER_PAGE_SIZE,
  canLoadMore,
  initialPickerState,
  nextOffset,
  pickerReducer,
} from "./picker-model";

const item = (id: string) => ({ id });
const key = (value: { id: string }) => value.id;

describe("picker paging", () => {
  it("pages 100 at a time, the API's maximum", () => {
    expect(PICKER_PAGE_SIZE).toBe(CATALOG_LIMITS.maxPageSize);
  });

  it("starts loading with nothing to load more", () => {
    expect(initialPickerState.status).toBe("loading");
    expect(canLoadMore(initialPickerState)).toBe(false);
    expect(nextOffset(initialPickerState)).toBe(0);
  });

  it("shows the first page and offers more while the server has more", () => {
    const state = pickerReducer(
      initialPickerState,
      { type: "loaded", items: [item("a"), item("b")], total: 5 },
      key,
    );
    expect(state.status).toBe("ready");
    expect(canLoadMore(state)).toBe(true);
    expect(nextOffset(state)).toBe(2);
  });

  it("appends the next page and stops offering more at the total", () => {
    let state = pickerReducer(
      initialPickerState,
      { type: "loaded", items: [item("a"), item("b")], total: 3 },
      key,
    );
    state = pickerReducer(state, { type: "moreRequested" }, key);
    expect(state.loadingMore).toBe(true);
    expect(canLoadMore(state)).toBe(false);
    state = pickerReducer(state, { type: "moreLoaded", items: [item("c")], total: 3 }, key);
    expect(state.items.map(key)).toEqual(["a", "b", "c"]);
    expect(state.loadingMore).toBe(false);
    expect(canLoadMore(state)).toBe(false);
  });

  it("does not list an item twice when the server's order shifted between pages", () => {
    let state = pickerReducer(
      initialPickerState,
      { type: "loaded", items: [item("a"), item("b")], total: 4 },
      key,
    );
    state = pickerReducer(
      state,
      { type: "moreLoaded", items: [item("b"), item("c")], total: 4 },
      key,
    );
    expect(state.items.map(key)).toEqual(["a", "b", "c"]);
  });

  it("keeps the loaded items when a further page fails, and lets the admin ask again", () => {
    let state = pickerReducer(
      initialPickerState,
      { type: "loaded", items: [item("a")], total: 3 },
      key,
    );
    state = pickerReducer(state, { type: "moreRequested" }, key);
    state = pickerReducer(state, { type: "moreFailed" }, key);
    expect(state.items.length).toBe(1);
    expect(state.moreFailed).toBe(true);
    expect(canLoadMore(state)).toBe(true);
    state = pickerReducer(state, { type: "moreRequested" }, key);
    expect(state.moreFailed).toBe(false);
  });

  it("fails the first page as a whole", () => {
    const state = pickerReducer(initialPickerState, { type: "failed" }, key);
    expect(state.status).toBe("error");
    expect(canLoadMore(state)).toBe(false);
  });

  it("stops at the API's offset limit even if the server reports more", () => {
    const items = Array.from({ length: CATALOG_LIMITS.maxOffset + 1 }, (_, index) =>
      item(`i${index}`),
    );
    const state = pickerReducer(initialPickerState, { type: "loaded", items, total: 50_000 }, key);
    expect(canLoadMore(state)).toBe(false);
  });

  it("a reload starts again from the first page", () => {
    let state = pickerReducer(
      initialPickerState,
      { type: "loaded", items: [item("a")], total: 2 },
      key,
    );
    state = pickerReducer(state, { type: "reset" }, key);
    expect(state).toEqual(initialPickerState);
  });
});
