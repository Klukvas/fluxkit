/**
 * The blog's store routes (`docs/api/features-blog.md`) as `StoreData.featureRead` calls: the store client knows no feature
 * route, so the slice sends its own request and checks the answer itself, field by field, as the client's response parser
 * does for the core routes. Pure (no environment, no Next): the manifest's sitemap uses it too, so it imports only types.
 */
import type { ProblemDetails, StoreResult } from "@fluxkit/api-client";
import type {
  MarkdownViewBlock,
  MarkdownViewDocument,
  MarkdownViewInline,
  MarkdownViewListItem,
} from "@fluxkit/ui";
import type { FeatureCall, FeatureCallContext } from "../../../../lib/store-data";

/** Posts per list page (the API's default `limit`). */
export const BLOG_PAGE_SIZE = 12;

export interface BlogCover {
  url: string;
  width: number;
  height: number;
  /** `null`: a decorative picture. */
  alt: string | null;
}

export interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string;
  updatedAt: string;
  cover: BlogCover | null;
}

export interface BlogPostList {
  items: BlogPostSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface BlogPost extends BlogPostSummary {
  seoTitle: string | null;
  seoDescription: string | null;
  /** The parsed body of the requested locale (ADR 0050), never HTML. */
  content: MarkdownViewDocument;
  /** The content locales the post is written in: its hreflang alternates. */
  locales: string[];
}

export interface BlogSitemapItem {
  slug: string;
  updatedAt: string;
  locales: string[];
}

export interface BlogSitemap {
  items: BlogSitemapItem[];
  /** More public posts exist than the route lists (the newest 5 000 are listed). */
  truncated: boolean;
}

/** An answer of a blog route that is not what `docs/api/features-blog.md` says. The message names the field, never a value. */
export class InvalidBlogResponseError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "InvalidBlogResponseError";
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(where: string, expected: string): never {
  throw new InvalidBlogResponseError(`${where} is not ${expected}.`);
}

function record(value: unknown, where: string): JsonObject {
  return isRecord(value) ? value : fail(where, "an object");
}

function text(value: unknown, where: string): string {
  return typeof value === "string" ? value : fail(where, "a string");
}

function optionalText(value: unknown, where: string): string | null {
  return value === null ? null : text(value, where);
}

function wholeNumber(value: unknown, where: string, minimum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum
    ? value
    : fail(where, `a whole number from ${String(minimum)}`);
}

function instant(value: unknown, where: string): string {
  const parsed = text(value, where);
  return Number.isNaN(Date.parse(parsed)) ? fail(where, "an ISO 8601 time") : parsed;
}

function list<T>(value: unknown, where: string, item: (entry: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) fail(where, "an array");
  return value.map((entry: unknown, index) => item(entry, `${where}[${String(index)}]`));
}

function cover(value: unknown, where: string): BlogCover | null {
  if (value === null) return null;
  const body = record(value, where);
  return {
    url: text(body.url, `${where}.url`),
    width: wholeNumber(body.width, `${where}.width`, 1),
    height: wholeNumber(body.height, `${where}.height`, 1),
    alt: optionalText(body.alt, `${where}.alt`),
  };
}

function summary(value: unknown, where: string): BlogPostSummary {
  const body = record(value, where);
  return {
    slug: text(body.slug, `${where}.slug`),
    title: text(body.title, `${where}.title`),
    excerpt: optionalText(body.excerpt, `${where}.excerpt`),
    publishedAt: instant(body.publishedAt, `${where}.publishedAt`),
    updatedAt: instant(body.updatedAt, `${where}.updatedAt`),
    cover: cover(body.cover, `${where}.cover`),
  };
}

/**
 * The inline nodes of a Markdown body. A node type this version does not know is kept as it is: node types are an additive
 * contract (`docs/contracts/markdown.md`) and `MarkdownView` skips them; the fields of every known type are checked.
 */
function inline(value: unknown, where: string): MarkdownViewInline {
  const node = record(value, where);
  switch (node.type) {
    case "text":
    case "inlineCode":
      return { type: node.type, value: text(node.value, `${where}.value`) };
    case "break":
      return { type: "break" };
    case "emphasis":
    case "strong":
      return { type: node.type, children: list(node.children, `${where}.children`, inline) };
    case "link":
      if (node.kind !== "path" && node.kind !== "https") fail(`${where}.kind`, '"path" or "https"');
      return {
        type: "link",
        kind: node.kind,
        href: text(node.href, `${where}.href`),
        children: list(node.children, `${where}.children`, inline),
      };
    default:
      text(node.type, `${where}.type`);
      return node as unknown as MarkdownViewInline;
  }
}

function listItem(value: unknown, where: string): MarkdownViewListItem {
  const node = record(value, where);
  if (node.type !== "listItem") fail(`${where}.type`, '"listItem"');
  return { type: "listItem", children: list(node.children, `${where}.children`, block) };
}

function block(value: unknown, where: string): MarkdownViewBlock {
  const node = record(value, where);
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: list(node.children, `${where}.children`, inline) };
    case "heading":
      if (node.level !== 2 && node.level !== 3 && node.level !== 4) {
        fail(`${where}.level`, "2, 3 or 4");
      }
      return {
        type: "heading",
        level: node.level,
        children: list(node.children, `${where}.children`, inline),
      };
    case "codeBlock":
      return { type: "codeBlock", value: text(node.value, `${where}.value`) };
    case "blockquote":
      return { type: "blockquote", children: list(node.children, `${where}.children`, block) };
    case "list":
      if (typeof node.ordered !== "boolean") fail(`${where}.ordered`, "a boolean");
      return {
        type: "list",
        ordered: node.ordered,
        start: wholeNumber(node.start, `${where}.start`, 0),
        items: list(node.items, `${where}.items`, listItem),
      };
    case "thematicBreak":
      return { type: "thematicBreak" };
    default:
      text(node.type, `${where}.type`);
      return node as unknown as MarkdownViewBlock;
  }
}

/** A `MarkdownDocument` (ADR 0050) as the API sends it, every known node checked. */
export function parseMarkdownDocument(value: unknown, where = "content"): MarkdownViewDocument {
  const body = record(value, where);
  if (body.type !== "document") fail(`${where}.type`, '"document"');
  return { type: "document", children: list(body.children, `${where}.children`, block) };
}

export function parsePostList(value: unknown): BlogPostList {
  const body = record(value, "the post list");
  return {
    items: list(body.items, "items", summary),
    total: wholeNumber(body.total, "total", 0),
    page: wholeNumber(body.page, "page", 1),
    limit: wholeNumber(body.limit, "limit", 1),
  };
}

export function parsePost(value: unknown): BlogPost {
  const post = summary(value, "the post");
  const body = record(value, "the post");
  return {
    ...post,
    seoTitle: optionalText(body.seoTitle, "seoTitle"),
    seoDescription: optionalText(body.seoDescription, "seoDescription"),
    content: parseMarkdownDocument(body.content),
    locales: list(body.locales, "locales", text),
  };
}

export function parseSitemap(value: unknown): BlogSitemap {
  const body = record(value, "the sitemap");
  if (typeof body.truncated !== "boolean") fail("truncated", "a boolean");
  return {
    items: list(body.items, "items", (entry, where) => {
      const item = record(entry, where);
      return {
        slug: text(item.slug, `${where}.slug`),
        updatedAt: instant(item.updatedAt, `${where}.updatedAt`),
        locales: list(item.locales, `${where}.locales`, text),
      };
    }),
    truncated: body.truncated,
  };
}

function isProblem(value: unknown): value is ProblemDetails {
  return (
    isRecord(value) &&
    (["type", "title", "code", "detail"] as const).every((key) => typeof value[key] === "string") &&
    typeof value.status === "number"
  );
}

function mediaType(response: Response): string {
  return (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new InvalidBlogResponseError(`${operation}: the body is not valid JSON.`, { cause });
  }
}

/**
 * One GET of a blog route: `200` with JSON is parsed by `parse`; a `4xx`/`5xx` with a problem body is handed back as a failed
 * result (`StoreData` decides: a 4xx is the page's to answer, a 5xx is an outage). Anything else throws, so a proxy's HTML
 * page is never taken for a post. A `fetch` rejection is thrown as it is (`StoreData` logs it and fails the read).
 */
async function getJson<T>(
  context: FeatureCallContext,
  operation: string,
  pathAndQuery: string,
  parse: (body: unknown) => T,
): Promise<StoreResult<T>> {
  const response = await context.fetch(`${context.baseUrl.replace(/\/+$/, "")}${pathAndQuery}`, {
    ...context.options.fetchOptions,
    method: "GET",
    headers: { Accept: "application/json, application/problem+json" },
    // A redirect is not part of any blog route: it is refused below instead of followed.
    redirect: "manual",
    ...(context.options.signal === undefined ? {} : { signal: context.options.signal }),
  });
  const { status } = response;
  if (status === 200 && mediaType(response) === "application/json") {
    try {
      return { ok: true, status, data: parse(await readJson(response, operation)) };
    } catch (error) {
      if (error instanceof InvalidBlogResponseError) {
        throw new InvalidBlogResponseError(`${operation}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
  if (status >= 400 && status <= 599 && mediaType(response) === "application/problem+json") {
    const problem = await readJson(response, operation);
    if (!isProblem(problem)) {
      throw new InvalidBlogResponseError(`${operation}: the problem body is malformed.`);
    }
    return { ok: false, status, problem, retryAfter: response.headers.get("Retry-After") };
  }
  throw new InvalidBlogResponseError(
    `${operation}: unexpected answer ${String(status)} (${mediaType(response) || "no content type"}).`,
  );
}

export const LIST_POSTS = "GET /store/blog/posts";
export const GET_POST = "GET /store/blog/posts/{slug}";
export const GET_SITEMAP = "GET /store/blog/sitemap";

/** One page of the public posts written in `locale`, newest first. */
export function listPostsCall(locale: string, page: number): FeatureCall<BlogPostList> {
  const query = new URLSearchParams({
    locale,
    page: String(page),
    limit: String(BLOG_PAGE_SIZE),
  });
  return (context) => getJson(context, LIST_POSTS, `/store/blog/posts?${query}`, parsePostList);
}

/** One public post in `locale` (`404` for an unknown slug, a draft, a scheduled post and a post not written in the locale). */
export function getPostCall(locale: string, slug: string): FeatureCall<BlogPost> {
  const query = new URLSearchParams({ locale });
  return (context) =>
    getJson(context, GET_POST, `/store/blog/posts/${encodeURIComponent(slug)}?${query}`, parsePost);
}

/** The public posts for the sitemap, newest first, at most 5 000. */
export const sitemapCall: FeatureCall<BlogSitemap> = (context) =>
  getJson(context, GET_SITEMAP, "/store/blog/sitemap", parseSitemap);
