import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";
import { ProductsRepository } from "./products.repository.js";
import { ProductsService } from "./products.service.js";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  // The option and variant modules lock the product row and read the detail through these.
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
