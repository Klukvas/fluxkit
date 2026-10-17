import {
  Global,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { StoreModule } from "../catalog/store/store.module.js";
import { markStoreCartResponseUncacheable } from "../common/store-path.js";
import { CART_CONFIG, type CartConfig } from "./cart-config.js";
import { CartController } from "./cart.controller.js";
import { CartMergeService } from "./cart-merge.service.js";
import { CartPricingService } from "./cart-pricing.service.js";
import { CartRepository } from "./cart.repository.js";
import { CartService } from "./cart.service.js";

/** `Cache-Control: no-store` before any guard or handler, so success and every error alike carry it. */
function storeCartNoStore(request: Request, response: Response, next: NextFunction): void {
  markStoreCartResponseUncacheable(request, response);
  next();
}

export interface CartModuleOptions {
  config: CartConfig;
}

/**
 * The shopper's cart (ADR 0015, plan step 4): `/store/cart/*` and the merge of the guest cart at sign-in, which
 * `CustomersModule` calls through `CartMergeService` (global, like the customer auth and rate limit modules). Core, no
 * feature flag. Needs the globals of `AuthModule` (clock), `CustomerAuthModule` (authenticator, cookie config),
 * `RateLimitModule`, `CommonModule` (locale, pricing) and the database; the catalog reads come from `StoreModule`.
 */
@Global()
@Module({})
export class CartModule implements NestModule {
  static register(options: CartModuleOptions): DynamicModule {
    return {
      module: CartModule,
      imports: [StoreModule],
      controllers: [CartController],
      providers: [
        { provide: CART_CONFIG, useValue: options.config },
        CartRepository,
        CartPricingService,
        CartService,
        CartMergeService,
      ],
      exports: [CartMergeService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(storeCartNoStore).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
