import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { StoreModule } from "../../catalog/store/store.module.js";
import { markStoreShippingResponseUncacheable } from "../../common/store-path.js";
import { ShippingCheckoutService } from "./shipping-checkout.service.js";
import { ShippingDirectoryService } from "./shipping-directory.service.js";
import { ShippingLookupService } from "./shipping-lookup.service.js";
import { ShippingOptionsService } from "./shipping-options.service.js";
import { ShippingStoreController } from "./shipping-store.controller.js";
import { ShippingStoreRepository } from "./shipping-store.repository.js";

/**
 * `no-store` before any guard or handler on every `/store/shipping` response, errors included; a lookup that succeeds then
 * replaces it with the public cache header (its handler).
 */
function storeShippingNoStore(request: Request, response: Response, next: NextFunction): void {
  markStoreShippingResponseUncacheable(request, response);
  next();
}

/**
 * The store side of shipping (ADR 0029 decisions 4 to 6, plan step 6): `GET /store/shipping/options`, the provider
 * lookups with their in-process cache, and the checkout's shipping step (`ShippingCheckoutService`, used by
 * `OrdersModule`). Core, no flag: with no active method the options are empty and the checkout is unchanged. Needs the
 * global provider registry, `CartModule` (the cart service), `CustomerAuthModule`, `RateLimitModule`, `CommonModule`,
 * the clock and the database.
 */
@Module({
  imports: [StoreModule],
  controllers: [ShippingStoreController],
  providers: [
    ShippingStoreRepository,
    ShippingDirectoryService,
    ShippingOptionsService,
    ShippingLookupService,
    ShippingCheckoutService,
  ],
  exports: [ShippingCheckoutService],
})
export class ShippingStoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(storeShippingNoStore).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
