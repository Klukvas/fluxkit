import { Body, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { AdminController, RequirePermission } from "@fluxkit/api-kit";
import { AdminBlogService } from "./admin-blog.service.js";
import { parseRequest } from "./problems.js";
import type { AdminPost, AdminPostSummary, Paged } from "./responses.js";
import {
  adminListQuerySchema,
  createPostSchema,
  postIdSchema,
  publishPostSchema,
  updatePostSchema,
} from "./schemas.js";

/** The part of the HTTP response a handler touches (Express's response, without depending on its types). */
interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

function postId(id: string): string {
  return parseRequest(postIdSchema, id, "id");
}

/**
 * `/admin/blog/posts` (plan sections 6 and 7). Kit defaults: `catalog.read` for GET, `catalog.write` for POST, PATCH and
 * DELETE; publish and unpublish need `catalog.publish`. The API guards every route under `/admin` (default deny, CSRF
 * header on writes, `Cache-Control: no-store`). Thin HTTP layer: validate, call the service, shape the status.
 */
@AdminController("blog/posts")
export class AdminBlogController {
  constructor(private readonly posts: AdminBlogService) {}

  @Get()
  list(@Query() query: unknown): Promise<Paged<AdminPostSummary>> {
    return this.posts.list(parseRequest(adminListQuerySchema, query));
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<AdminPost> {
    return this.posts.get(postId(id));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderSink,
  ): Promise<AdminPost> {
    const created = await this.posts.create(parseRequest(createPostSchema, body));
    response.setHeader("Location", `/admin/blog/posts/${created.id}`);
    return created;
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown): Promise<AdminPost> {
    const checkedId = postId(id);
    return this.posts.update(checkedId, parseRequest(updatePostSchema, body));
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("catalog.publish")
  publish(@Param("id") id: string, @Body() body: unknown): Promise<AdminPost> {
    const checkedId = postId(id);
    // No body at all is the same as `{}`: publish with the stored date, else now.
    return this.posts.publish(checkedId, parseRequest(publishPostSchema, body ?? {}));
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  @RequirePermission("catalog.publish")
  unpublish(@Param("id") id: string): Promise<AdminPost> {
    return this.posts.unpublish(postId(id));
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@Param("id") id: string): Promise<void> {
    return this.posts.delete(postId(id));
  }
}
