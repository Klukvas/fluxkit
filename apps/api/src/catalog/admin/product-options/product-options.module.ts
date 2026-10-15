import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module.js";
import { VariantsModule } from "../variants/variants.module.js";
import { ProductOptionsController } from "./product-options.controller.js";
import { ProductOptionsRepository } from "./product-options.repository.js";
import { ProductOptionsService } from "./product-options.service.js";

@Module({
  imports: [ProductsModule, VariantsModule],
  controllers: [ProductOptionsController],
  providers: [ProductOptionsService, ProductOptionsRepository],
})
export class ProductOptionsModule {}
