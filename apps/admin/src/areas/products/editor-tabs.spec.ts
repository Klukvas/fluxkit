import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { shouldBlockNavigation } from "../../router/unsaved-changes";
import { PRODUCT_EDITOR_TABS } from "../../layout/product-editor";
import { NO_DIRTY_TABS, dirtyTab, readTab, tabSearch, visibleTabs, withDirty } from "./editor-tabs";
import { EDITOR_TAB_IDS } from "./publish-problems";

describe("editor tab configuration", () => {
  it("lists every tab once, in the plan's order: General, Attributes, Categories, Media, Options, Variants, Prices, Stock", () => {
    expect(PRODUCT_EDITOR_TABS.map((tab) => tab.id)).toEqual([...EDITOR_TAB_IDS]);
    for (const tab of PRODUCT_EDITOR_TABS) {
      expect(tab.messageKey, tab.id).toBe(`products.tab.${tab.id}`);
      expect(typeof tab.Panel, tab.id).toBe("function");
    }
  });

  it("shows a tab only to an admin whose permissions allow its read (all catalog.read today)", () => {
    expect(
      visibleTabs(PRODUCT_EDITOR_TABS, [...ROLE_PERMISSIONS.viewer]).map((tab) => tab.id),
    ).toEqual([...EDITOR_TAB_IDS]);
    expect(visibleTabs(PRODUCT_EDITOR_TABS, ["orders.read"])).toEqual([]);
    expect(visibleTabs(PRODUCT_EDITOR_TABS, null)).toEqual([]);
  });
});

describe("the selected tab in the URL (?tab=)", () => {
  const ids = ["general", "attributes", "categories"] as const;
  it("reads the tab, or the first visible one for a missing, unknown or hidden tab", () => {
    expect(readTab(new URLSearchParams("tab=attributes"), ids)).toBe("attributes");
    expect(readTab(new URLSearchParams(""), ids)).toBe("general");
    expect(readTab(new URLSearchParams("tab=nope"), ids)).toBe("general");
    expect(readTab(new URLSearchParams("tab=stock"), ids)).toBe("general");
    expect(readTab(new URLSearchParams("tab=stock"), [])).toBeNull();
  });

  it("writes the first tab as the bare path and the others as ?tab=", () => {
    expect(tabSearch("general", ids)).toBe("");
    expect(tabSearch("categories", ids)).toBe("?tab=categories");
  });

  it("a tab switch changes the query string, so the unsaved-changes guard asks before a dirty tab is left", () => {
    const at = (search: string) => ({ pathname: "/products/x", search, hash: "" });
    expect(shouldBlockNavigation(true, at(""), at(tabSearch("attributes", ids)))).toBe(true);
    expect(shouldBlockNavigation(false, at(""), at(tabSearch("attributes", ids)))).toBe(false);
  });
});

describe("dirty state per tab", () => {
  it("is tracked per tab and names the tab with unsaved changes", () => {
    expect(dirtyTab(NO_DIRTY_TABS)).toBeNull();
    const dirty = withDirty(NO_DIRTY_TABS, "attributes", true);
    expect(dirtyTab(dirty)).toBe("attributes");
    expect(NO_DIRTY_TABS).toEqual({});
    expect(dirtyTab(withDirty(dirty, "attributes", false))).toBeNull();
    expect(withDirty(dirty, "attributes", true)).toBe(dirty);
  });
});
