import { Module } from "@nestjs/common";

/*
 * The blog feature (flag `blog` in FEATURES_ENABLED; plan docs/plans/2026-11-13-blog.md). The API imports this entry only when
 * the flag is on; it reaches the API through `@fluxkit/api-kit` and core only.
 */
@Module({})
export class BlogFeatureModule {}

export const featureModule = BlogFeatureModule;

export { personalDataInventory } from "./inventory.js";
