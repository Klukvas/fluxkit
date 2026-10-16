import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module.js";
import { PricesController } from "./prices.controller.js";
import { PricesRepository } from "./prices.repository.js";
import { PricesService } from "./prices.service.js";

@Module({
  imports: [ProductsModule],
  controllers: [PricesController],
  providers: [PricesService, PricesRepository],
})
export class PricesModule {}
