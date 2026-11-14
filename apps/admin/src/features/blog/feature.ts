import type { AdminFeatureManifest, FeaturePage } from "../manifest";
import { BLOG_PATHS } from "./blog-route-paths";

/*
 * The blog's admin manifest (feature `blog`, docs/plans/2026-11-13-blog.md section 10; API `docs/api/features-blog.md`).
 * Found by `features/registry.ts`; nothing else imports this folder. Removing the feature deletes this folder with the
 * package `packages/features/blog/` and the storefront slice (`packages/features/blog/README.md`).
 */

function page(pick: (module: typeof import("./pages")) => FeaturePage["Component"]) {
  return (): Promise<FeaturePage> =>
    import("./pages").then((module) => ({
      Component: pick(module),
      messageFiles: module.MESSAGE_FILES,
    }));
}

export const feature: AdminFeatureManifest = {
  name: "blog",
  routes: [
    {
      id: "feature.blog.list",
      path: BLOG_PATHS.list,
      permission: "catalog.read",
      titleKey: "features.blog.page.list.title",
      load: page((module) => module.BlogListPage),
    },
    {
      id: "feature.blog.new",
      path: BLOG_PATHS.create,
      permission: "catalog.write",
      titleKey: "features.blog.page.new.title",
      load: page((module) => module.BlogNewPage),
    },
    {
      id: "feature.blog.detail",
      path: BLOG_PATHS.detail,
      permission: "catalog.read",
      titleKey: "features.blog.page.detail.title",
      load: page((module) => module.BlogDetailPage),
    },
  ],
  navigation: { group: "storefront", labelKey: "features.blog.nav", routeId: "feature.blog.list" },
  messages: {
    uk: () => import("./messages/uk.json").then((module) => module.default),
    en: () => import("./messages/en.json").then((module) => module.default),
  },
};
