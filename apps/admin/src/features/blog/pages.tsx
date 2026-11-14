import type { LazyFile } from "../../messages";
import { featureMessageFile } from "../manifest";
import { BlogDetailPage, BlogNewPage } from "./blog-editor-pages";
import { BlogListPage } from "./blog-list-page";

/**
 * The blog's screens, one lazy chunk (loaded by the manifest's routes, never by the entry). They reuse the catalog
 * dictionaries' form parts, upload queue, pager and notices, so they load that area's messages too, plus their own.
 */
export const MESSAGE_FILES: readonly LazyFile[] = [
  "catalog-dictionaries",
  featureMessageFile("blog"),
];

/** `/features/blog`: the posts. */
export { BlogListPage };
/** `/features/blog/new`: a new draft. */
export { BlogNewPage };
/** `/features/blog/:id`: edit, publish, schedule, unpublish or delete one post. */
export { BlogDetailPage };
