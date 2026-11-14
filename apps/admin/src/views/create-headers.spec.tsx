import { createTranslator, type Translator } from "@fluxkit/ui";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { BannersListFrame } from "../areas/banners/banners-page";
import { BANNER_LIMITS } from "../areas/banners/banner-rules";
import { CategoryListFrame } from "../areas/catalog-dictionaries/categories-page";
import { ListScreen } from "../areas/catalog-dictionaries/list-screen";
import { MethodsListFrame } from "../areas/shipping/methods-page";
import { UserListView } from "../areas/users/user-list-view";
import {
  messagesForArea,
  pageHeaderMarkup,
  primaryHeaderControls,
  renderInRouter,
} from "../test-helpers";

const noop = () => undefined;
const cases: {
  name: string;
  labelKey: string;
  render: (t: Translator, canCreate: boolean) => ReactElement;
}[] = [
  {
    name: "banners",
    labelKey: "banners.new",
    render: (t, canWrite) => (
      <BannersListFrame t={t} canWrite={canWrite} count={1}>
        {null}
      </BannersListFrame>
    ),
  },
  {
    name: "categories",
    labelKey: "dict.category.new",
    render: (t, canWrite) => (
      <CategoryListFrame t={t} canWrite={canWrite}>
        {null}
      </CategoryListFrame>
    ),
  },
  {
    name: "shipping",
    labelKey: "ship.list.create",
    render: (t, canManage) => (
      <MethodsListFrame t={t} canManage={canManage}>
        {null}
      </MethodsListFrame>
    ),
  },
  {
    name: "users",
    labelKey: "user.list.create",
    render: (t, canCreate) => <UserListView t={t} canCreate={canCreate} results={null} />,
  },
  ...(
    [
      ["brands", "brand"],
      ["productTypes", "productType"],
      ["attributes", "attribute"],
      ["options", "option"],
    ] as const
  ).map(([current, singular]) => ({
    name: current,
    labelKey: `dict.${singular}.new`,
    render: (t: Translator, canWrite: boolean) => (
      <ListScreen
        t={t}
        current={current}
        title={t(`page.${current}.title`)}
        state={{ status: "loading" }}
        onRetry={noop}
        canWrite={canWrite}
        createTo={`/${current}/new`}
        createLabel={t(`dict.${singular}.new`)}
        caption={t(`dict.${singular}.listCaption`)}
        columns={[{ id: "name", header: t(`dict.${singular}.listCaption`), cell: () => "" }]}
        rowKey={() => "row"}
        emptyTitle=""
        emptyBody=""
        limit={50}
        offset={0}
        hrefForOffset={() => "/"}
      />
    ),
  })),
];

describe("create headers", () => {
  for (const locale of ["uk", "en"] as const) {
    for (const scenario of cases) {
      for (const canCreate of [true, false]) {
        it(`${scenario.name}/${locale}/canCreate=${canCreate}: one visible named primary link or none`, async () => {
          const t = createTranslator(
            await messagesForArea(locale, ["banners", "catalog-dictionaries", "shipping", "users"]),
            locale,
          );
          const header = pageHeaderMarkup(renderInRouter(scenario.render(t, canCreate)));
          expect(header.match(/<h1\b/g)).toHaveLength(1);
          const primary = primaryHeaderControls(header);
          expect(primary).toHaveLength(canCreate ? 1 : 0);
          if (canCreate) {
            expect(primary[0]).toMatch(/^<a\b/);
            expect(primary[0]).toContain(t(scenario.labelKey));
            expect(primary[0]).toContain('aria-hidden="true"');
            expect(primary[0]).toContain("gap-2");
          }
        });
      }
    }
  }
  for (const count of [null, 0, BANNER_LIMITS.maxStored]) {
    it(`keeps banner creation out of the header at count=${count}`, async () => {
      const t = createTranslator(await messagesForArea("en", ["banners"]), "en");
      const header = pageHeaderMarkup(
        renderInRouter(
          <BannersListFrame t={t} canWrite count={count}>
            {null}
          </BannersListFrame>,
        ),
      );
      expect(primaryHeaderControls(header)).toHaveLength(0);
    });
  }
});
