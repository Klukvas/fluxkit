import { Module } from "@nestjs/common";
import { ShippingMethodsController } from "./shipping-methods.controller.js";
import { ShippingMethodsRepository } from "./shipping-methods.repository.js";
import { ShippingMethodsService } from "./shipping-methods.service.js";
import { ShippingProviderSettingsRepository } from "./shipping-provider-settings.repository.js";
import { ShippingProvidersController } from "./shipping-providers.controller.js";
import { ShippingProvidersService } from "./shipping-providers.service.js";

/**
 * The admin settings API of shipping (ADR 0029 decision 13): methods with their rates, and the non-secret profile and
 * connection check of each enabled provider. Reads the provider registry (global); changes no checkout or store route.
 */
@Module({
  controllers: [ShippingMethodsController, ShippingProvidersController],
  providers: [
    ShippingMethodsService,
    ShippingMethodsRepository,
    ShippingProvidersService,
    ShippingProviderSettingsRepository,
  ],
})
export class ShippingAdminModule {}
