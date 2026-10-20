import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { shouldBlockNavigation } from "../../router/unsaved-changes";
import { PRODUCT_EDITOR_TABS } from "../../layout/product-editor";
import {
  NO_DIRTY_TABS,
  dirtyTab,
  productRevision,
  readTab,
  tabSearch,
  visibleTabs,
  withDirty,
} from "./editor-tabs";
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

describe("the revision a tab is keyed by (remounted with the stored data after a write)", () => {
  const variant = (id: string, updatedAt = "2026-10-20T10:00:00.000Z") => ({
    id,
    updatedAt,
  });
  const base = {
    updatedAt: "2026-10-20T09:00:00.000Z",
    categories: [{ categoryId: "c1", isPrimary: true, position: 0 }],
    media: [{ id: "m1", updatedAt: "2026-10-20T09:00:00.000Z" }],
    options: [{ optionId: "o1", values: [{ optionValueId: "v1" }] }],
    variants: [variant("a"), variant("b")],
  };

  it("is the same for the same stored content", () => {
    expect(productRevision(base)).toBe(productRevision(structuredClone(base)));
    expect(productRevision(base)).toMatch(/^[0-9a-f]+$/);
  });

  it("changes when the product, a variant, the variant set, the media, the options or the categories change", () => {
    const changed = [
      { ...base, updatedAt: "2026-10-20T11:00:00.000Z" },
      { ...base, variants: [variant("a"), variant("b", "2026-10-20T12:00:00.000Z")] },
      { ...base, variants: [variant("a")] },
      { ...base, variants: [variant("b"), variant("a")] },
      { ...base, media: [{ id: "m2", updatedAt: "2026-10-20T09:00:00.000Z" }] },
      { ...base, options: [{ optionId: "o1", values: [{ optionValueId: "v2" }] }] },
      { ...base, categories: [{ categoryId: "c1", isPrimary: false, position: 0 }] },
    ];
    for (const product of changed) expect(productRevision(product)).not.toBe(productRevision(base));
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
