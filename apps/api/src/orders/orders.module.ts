import {
  Global,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ORDER_PAYMENTS_PORT } from "@fluxkit/core";
import { StoreModule } from "../catalog/store/store.module.js";
import { markStoreOrderResponseUncacheable } from "../common/store-path.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { AccountOrdersController } from "./account-orders.controller.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutService } from "./checkout.service.js";
import { OrderViewService } from "./order-view.js";
import { ORDERS_CONFIG, type OrdersConfig } from "./orders-config.js";
import { OrdersRepository } from "./orders.repository.js";
import { OrdersService } from "./orders.service.js";
import { StoreOrdersController } from "./store-orders.controller.js";
import { StoreOrdersService } from "./store-orders.service.js";

/** `Cache-Control: no-store` before any guard or handler, so success and every error alike carry it. */
function storeOrderNoStore(request: Request, response: Response, next: NextFunction): void {
  markStoreOrderResponseUncacheable(request, response);
  next();
}

export interface OrdersModuleOptions {
  config: OrdersConfig;
}

/**
 * Checkout and orders (ADR 0015, 0017, plan step 5b): `POST /store/checkout`, the guest order routes under
 * `/store/orders` and the customer's own under `/store/account/orders`, plus the order domain service (status
 * transitions, `markPaid`, cancellations, expiry of one order) that the admin API and the scheduler use later. Core, no
 * feature flag. Global because `OrdersService` (and the `ORDER_PAYMENTS_PORT` it implements) is how other modules and
 * plugins act on orders. Needs the globals of `AuthModule` (clock), `CustomerAuthModule`, `RateLimitModule`,
 * `CommonModule`, `CartModule` (pricing, repository) and the database; stock comes from `InventoryModule`.
 */
@Global()
@Module({})
export class OrdersModule implements NestModule {
  static register(options: OrdersModuleOptions): DynamicModule {
    return {
      module: OrdersModule,
      imports: [StoreModule, InventoryModule],
      controllers: [CheckoutController, StoreOrdersController, AccountOrdersController],
      providers: [
        { provide: ORDERS_CONFIG, useValue: options.config },
        OrdersRepository,
        OrdersService,
        OrderViewService,
        CheckoutService,
        StoreOrdersService,
        { provide: ORDER_PAYMENTS_PORT, useExisting: OrdersService },
      ],
      exports: [OrdersService, OrdersRepository, OrderViewService, ORDER_PAYMENTS_PORT],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(storeOrderNoStore).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
