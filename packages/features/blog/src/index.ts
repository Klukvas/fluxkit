import { Module } from "@nestjs/common";
import { AdminBlogController } from "./admin-blog.controller.js";
import { AdminBlogService } from "./admin-blog.service.js";
import { BlogRepository } from "./blog.repository.js";
import { StoreBlogController } from "./store-blog.controller.js";
import { StoreBlogService } from "./store-blog.service.js";

/*
 * The blog feature (flag `blog` in FEATURES_ENABLED; plan docs/plans/2026-11-13-blog.md, README.md). The API imports this
 * entry only when the flag is on; it reaches the API through `@fluxkit/api-kit` (problems, permissions, the database, media
 * and locale tokens) and core only.
 */
@Module({
  controllers: [StoreBlogController, AdminBlogController],
  providers: [BlogRepository, AdminBlogService, StoreBlogService],
})
export class BlogFeatureModule {}

export const featureModule = BlogFeatureModule;

export { personalDataInventory } from "./inventory.js";
