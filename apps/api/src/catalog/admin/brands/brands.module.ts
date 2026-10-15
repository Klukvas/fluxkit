import { Module } from "@nestjs/common";
import { BrandsController } from "./brands.controller.js";
import { BrandsRepository } from "./brands.repository.js";
import { BrandsService } from "./brands.service.js";

@Module({
  controllers: [BrandsController],
  providers: [BrandsService, BrandsRepository],
})
export class BrandsModule {}
