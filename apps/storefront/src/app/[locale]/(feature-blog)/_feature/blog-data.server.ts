import { cache } from "react";
import { featureData } from "../../../../features/runtime.server";
import { loadBlogList, loadBlogPost } from "./blog-data";

/**
 * The blog's reads against the running app's API (server code only). Once per request each: `generateMetadata` and the page
 * of a post share one read.
 */
const blog = featureData("blog");

export const getBlogList = cache((locale: string, page: number) =>
  loadBlogList(blog, locale, page),
);

export const getBlogPost = cache((locale: string, slug: string) =>
  loadBlogPost(blog, locale, slug),
);
