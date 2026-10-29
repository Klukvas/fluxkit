import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { visibleNavigation } from "../../layout/navigation";
import { canAccess } from "../../permissions";
import { ROUTES } from "../../routes";
import { SEARCH_WRITE_OPERATIONS, canManageSearch } from "./search-permissions";

const SEARCH_ROUTE_IDS = ["search", "searchSynonyms"];

/**
 * The permission table of the Search area per role (search plan question 12: `catalog.read` reads, `catalog.write`
 * changes): the navigation entry, the two routes and the write controls. Written by hand, not derived from the code under
 * test. The viewer reads the status and the synonym groups but changes nothing.
 */
const TABLE = {
  owner: { navigation: true, routes: true, writes: true },
  manager: { navigation: true, routes: true, writes: true },
  viewer: { navigation: true, routes: true, writes: false },
} as const;

describe("the Search area per role", () => {
  for (const role of ["owner", "manager", "viewer"] as const) {
    it(`${role}: navigation ${String(TABLE[role].navigation)}, routes ${String(TABLE[role].routes)}, writes ${String(TABLE[role].writes)}`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]];
      const items = visibleNavigation(permissions).flatMap((group) =>
        group.items.map((item) => item.routeId),
      );
      expect(items.includes("search")).toBe(TABLE[role].navigation);
      for (const id of SEARCH_ROUTE_IDS) {
        const route = ROUTES.find((entry) => entry.id === id);
        expect(route, id).toBeDefined();
        expect(canAccess(permissions, route?.permission ?? "denied"), `${role} ${id}`).toBe(
          TABLE[role].routes,
        );
      }
      expect(canManageSearch(permissions)).toBe(TABLE[role].writes);
    });
  }

  it("guards both routes with catalog.read (their reads) and offers no navigation entry for the synonyms (a sub-navigation link)", () => {
    for (const id of SEARCH_ROUTE_IDS) {
      expect(ROUTES.find((entry) => entry.id === id)?.permission, id).toBe("catalog.read");
    }
    const items = visibleNavigation([...ROLE_PERMISSIONS.owner]).flatMap((group) =>
      group.items.map((item) => item.routeId),
    );
    expect(items).not.toContain("searchSynonyms");
  });

  it("needs catalog.write for every write and for nothing less", () => {
    expect([...SEARCH_WRITE_OPERATIONS].sort()).toEqual(
      [
        "createSynonymGroup",
        "deleteSynonymGroup",
        "requestSearchRebuild",
        "updateSynonymGroup",
      ].sort(),
    );
    expect(canManageSearch(["catalog.write"])).toBe(true);
    expect(canManageSearch(["catalog.read"])).toBe(false);
    expect(canManageSearch(["catalog.publish", "orders.write", "shipping.manage"])).toBe(false);
    expect(canManageSearch([])).toBe(false);
    expect(canManageSearch(null)).toBe(false);
  });
});
