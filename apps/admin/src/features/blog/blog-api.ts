import type {
  AdminResult,
  CallOptions,
  LocalizedText,
  TransportOperation,
} from "@fluxkit/api-client";
import { adminFeatureTransport } from "../../lib/api";

/*
 * The blog's admin routes (`docs/api/features-blog.md`). They are not in the core API document, so they are not in the
 * client's operation table: this file describes them for the shared transport (`adminFeatureTransport`: CSRF header, time
 * limits, session signals, problem parsing). The shapes are the API's (`packages/features/blog/src/responses.ts`).
 */

export const BLOG_POST_STATES = ["draft", "scheduled", "published"] as const;
export type BlogPostState = (typeof BLOG_POST_STATES)[number];

export interface BlogPostSummary {
  id: string;
  slug: string;
  status: "draft" | "published";
  state: BlogPostState;
  title: LocalizedText;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogCover {
  uploadId: string;
  url: string;
  width: number;
  height: number;
}

export interface BlogPost extends BlogPostSummary {
  /** True once the post has a publish date: the slug can no longer change. */
  slugLocked: boolean;
  excerpt: LocalizedText | null;
  body: LocalizedText;
  seoTitle: LocalizedText | null;
  seoDescription: LocalizedText | null;
  coverUploadId: string | null;
  /** `null` without a cover, or when its upload can no longer be described. */
  cover: BlogCover | null;
  coverAlt: LocalizedText | null;
}

export interface BlogPostPage {
  items: BlogPostSummary[];
  total: number;
  page: number;
  limit: number;
}

/** Create: `title` is required (with the default locale); without `slug` the API makes one from that title. */
export interface CreateBlogPostBody {
  slug?: string;
  title: LocalizedText;
  excerpt?: LocalizedText;
  body?: LocalizedText;
  seoTitle?: LocalizedText;
  seoDescription?: LocalizedText;
  coverUploadId?: string;
  coverAlt?: LocalizedText;
}

/** PATCH: only the given fields change; a map replaces the whole map, `null` clears an optional one. */
export interface UpdateBlogPostBody {
  slug?: string;
  title?: LocalizedText;
  excerpt?: LocalizedText | null;
  body?: LocalizedText;
  seoTitle?: LocalizedText | null;
  seoDescription?: LocalizedText | null;
  coverUploadId?: string | null;
  coverAlt?: LocalizedText | null;
}

export interface PublishBlogPostBody {
  /** ISO 8601 instant; a future one schedules the post. Without it the stored date, else now. */
  publishedAt?: string;
}

export interface ListBlogPostsOptions extends CallOptions {
  status?: BlogPostState;
  page?: number;
  limit?: number;
}

const POSTS = "/admin/blog/posts";
const POST = `${POSTS}/{id}`;

export const BLOG_OPERATIONS = {
  listBlogPosts: {
    method: "GET",
    path: POSTS,
    successStatuses: [200],
    query: ["status", "page", "limit"],
  },
  getBlogPost: { method: "GET", path: POST, successStatuses: [200], query: [] },
  createBlogPost: {
    method: "POST",
    path: POSTS,
    successStatuses: [201],
    query: [],
    bodyKind: "json",
  },
  updateBlogPost: {
    method: "PATCH",
    path: POST,
    successStatuses: [200],
    query: [],
    bodyKind: "json",
  },
  publishBlogPost: {
    method: "POST",
    path: `${POST}/publish`,
    successStatuses: [200],
    query: [],
    bodyKind: "json",
  },
  unpublishBlogPost: {
    method: "POST",
    path: `${POST}/unpublish`,
    successStatuses: [200],
    query: [],
    bodyKind: "none",
  },
  deleteBlogPost: { method: "DELETE", path: POST, successStatuses: [204], query: [] },
} as const satisfies Record<string, TransportOperation>;

type Result<T> = Promise<AdminResult<T>>;

/** The blog's admin requests. `send` is the shared transport; a test passes a fake. */
export function createBlogApi(send = adminFeatureTransport) {
  const ops = BLOG_OPERATIONS;
  return {
    listBlogPosts: (options?: ListBlogPostsOptions): Result<BlogPostPage> =>
      send(ops.listBlogPosts, { options }),
    getBlogPost: (id: string, options?: CallOptions): Result<BlogPost> =>
      send(ops.getBlogPost, { pathParams: { id }, options }),
    createBlogPost: (body: CreateBlogPostBody, options?: CallOptions): Result<BlogPost> =>
      send(ops.createBlogPost, { body, options }),
    updateBlogPost: (
      id: string,
      body: UpdateBlogPostBody,
      options?: CallOptions,
    ): Result<BlogPost> => send(ops.updateBlogPost, { pathParams: { id }, body, options }),
    publishBlogPost: (
      id: string,
      body: PublishBlogPostBody,
      options?: CallOptions,
    ): Result<BlogPost> => send(ops.publishBlogPost, { pathParams: { id }, body, options }),
    unpublishBlogPost: (id: string, options?: CallOptions): Result<BlogPost> =>
      send(ops.unpublishBlogPost, { pathParams: { id }, options }),
    deleteBlogPost: (id: string, options?: CallOptions): Result<undefined> =>
      send(ops.deleteBlogPost, { pathParams: { id }, options }),
  };
}

export type BlogApi = ReturnType<typeof createBlogApi>;

export const blogApi: BlogApi = createBlogApi();
