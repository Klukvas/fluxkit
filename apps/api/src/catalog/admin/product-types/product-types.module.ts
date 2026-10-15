import { Module } from "@nestjs/common";
import { ProductTypesController } from "./product-types.controller.js";
import { ProductTypesRepository } from "./product-types.repository.js";
import { ProductTypesService } from "./product-types.service.js";

@Module({
  controllers: [ProductTypesController],
  providers: [ProductTypesService, ProductTypesRepository],
})
export class ProductTypesModule {}
