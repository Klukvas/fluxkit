import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module.js";
import { VariantGenerationService } from "./variant-generation.service.js";
import { VariantsController } from "./variants.controller.js";
import { VariantsRepository } from "./variants.repository.js";
import { VariantsService } from "./variants.service.js";

@Module({
  imports: [ProductsModule],
  controllers: [VariantsController],
  providers: [VariantsService, VariantsRepository, VariantGenerationService],
  // The option routes regenerate variants through the same service.
  exports: [VariantGenerationService],
})
export class VariantsModule {}
