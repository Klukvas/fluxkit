import { Controller, Get, Param, Query } from "@nestjs/common";
import { parseRequest } from "./problems.js";
import type { Paged, StorePost, StorePostSummary, StoreSitemap } from "./responses.js";
import { storeListQuerySchema, storePostQuerySchema, storeSitemapQuerySchema } from "./schemas.js";
import { StoreBlogService } from "./store-blog.service.js";

/**
 * `/store/blog` (plan section 6): public, read-only, no cookie and no `Cache-Control` from the API (like
 * `GET /store/banners`; the storefront caches for 60 s). Public posts and public fields only.
 */
@Controller("store/blog")
export class StoreBlogController {
  constructor(private readonly posts: StoreBlogService) {}

  @Get("posts")
  list(@Query() query: unknown): Promise<Paged<StorePostSummary>> {
    return this.posts.list(parseRequest(storeListQuerySchema, query));
  }

  @Get("posts/:slug")
  get(@Param("slug") slug: string, @Query() query: unknown): Promise<StorePost> {
    return this.posts.get(slug, parseRequest(storePostQuerySchema, query).locale);
  }

  @Get("sitemap")
  sitemap(@Query() query: unknown): Promise<StoreSitemap> {
    parseRequest(storeSitemapQuerySchema, query);
    return this.posts.sitemap();
  }
}
