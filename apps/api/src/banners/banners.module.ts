import { Module } from "@nestjs/common";
import { AdminBannersController } from "./admin-banners.controller.js";
import { BannersRepository } from "./banners.repository.js";
import { BannersService } from "./banners.service.js";
import { StoreBannersController } from "./store-banners.controller.js";
import { StoreBannersService } from "./store-banners.service.js";

/**
 * Home banners (ADR 0046): core content, no feature flag. Admin routes under `/admin/banners`, the public read under
 * `/store/banners`. Self-contained: no other module imports it. Uses the global media module for attach marking.
 */
@Module({
  controllers: [AdminBannersController, StoreBannersController],
  providers: [BannersRepository, BannersService, StoreBannersService],
})
export class BannersModule {}
