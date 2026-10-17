import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { markStoreAccountResponseUncacheable } from "../common/store-path.js";
import { AccountController } from "./account/account.controller.js";
import { CustomerAccountService } from "./account/account.service.js";
import { AdminCustomersController } from "./admin/admin-customers.controller.js";
import { AdminCustomersService } from "./admin/admin-customers.service.js";
import { CustomerRepository } from "./customer.repository.js";

/** `Cache-Control: no-store` before any guard or handler, so success and every error alike carry it. */
function storeAccountNoStore(request: Request, response: Response, next: NextFunction): void {
  markStoreAccountResponseUncacheable(request, response);
  next();
}

/**
 * Customer accounts (ADR 0016, plan step 3b): the store account routes (`/store/account/*`) and the admin customer
 * management (`/admin/customers/*`). Core, no feature flag. Needs the globals of `AuthModule` (clock, password
 * hasher), `CustomerAuthModule` (sessions, guard, config), `RateLimitModule` and the database.
 */
@Module({
  controllers: [AccountController, AdminCustomersController],
  providers: [CustomerRepository, CustomerAccountService, AdminCustomersService],
})
export class CustomersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(storeAccountNoStore).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
