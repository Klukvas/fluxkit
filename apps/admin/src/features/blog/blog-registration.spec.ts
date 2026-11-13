import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { FEATURE_NAVIGATION, visibleNavigation } from "../../layout/navigation";
import { FEATURE_ROUTES } from "../../routes";
import { feature } from "./feature";

/** How the blog plugs into the admin through its manifest (plan section 10, owner's answer 7 (a)). Deleted with the slice. */
describe("the blog's admin manifest", () => {
  it("registers three screens with the plan's permissions", () => {
    expect(
      FEATURE_ROUTES.filter((route) => route.feature === "blog").map((route) => [
        route.id,
        route.path,
        route.permission,
        route.titleKey,
      ]),
    ).toEqual([
      ["feature.blog.list", "/features/blog", "catalog.read", "features.blog.page.list.title"],
      ["feature.blog.new", "/features/blog/new", "catalog.write", "features.blog.page.new.title"],
      [
        "feature.blog.detail",
        "/features/blog/:id",
        "catalog.read",
        "features.blog.page.detail.title",
      ],
    ]);
  });

  it("adds Blog after Home banners in the Storefront group, for every role that reads the catalog", () => {
    expect(FEATURE_NAVIGATION.find((entry) => entry.feature === "blog")).toEqual({
      feature: "blog",
      group: "storefront",
      routeId: "feature.blog.list",
      labelKey: "features.blog.nav",
      href: "/features/blog",
      permission: "catalog.read",
    });
    for (const role of ["owner", "manager", "viewer"] as const) {
      const storefront = visibleNavigation([...ROLE_PERMISSIONS[role]], ["blog"]).find(
        (group) => group.id === "storefront",
      );
      expect(
        storefront?.items.map((item) => item.routeId),
        role,
      ).toEqual(["banners", "feature.blog.list"]);
    }
    // Without the feature in GET /admin/config the entry is not there.
    expect(
      visibleNavigation([...ROLE_PERMISSIONS.owner], [])
        .flatMap((group) => group.items)
        .some((item) => item.routeId === "feature.blog.list"),
    ).toBe(false);
  });

  it("loads its screens and its messages as their own chunks, with the core files the screens reuse", async () => {
    for (const route of feature.routes) {
      const page = await route.load();
      expect(typeof page.Component, route.id).toBe("function");
      expect(page.messageFiles, route.id).toEqual(["catalog-dictionaries", "feature:blog"]);
    }
    const en = await feature.messages.en();
    expect(en["features.blog.nav"]).toBe("Blog");
    expect((await feature.messages.uk())["features.blog.nav"]).toBe("Блог");
  });
});
