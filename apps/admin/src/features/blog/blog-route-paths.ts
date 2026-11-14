/**
 * The blog's screens, relative to the SPA's base path (a feature's paths start with `/features/<name>`). A module of its
 * own without imports: the manifest (in the entry chunk) needs nothing else of the slice.
 */
export const BLOG_PATHS = {
  list: "/features/blog",
  create: "/features/blog/new",
  detail: "/features/blog/:id",
} as const;
