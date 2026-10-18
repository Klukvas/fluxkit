import { Body, Headers, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { setCartCookie } from "../cart/cart-cookie.js";
import { CART_CONFIG, type CartConfig } from "../cart/cart-config.js";
import { resolveShopper } from "../cart/cart-owner.js";
import { StoreController } from "../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../common/openapi.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  CUSTOMER_AUTHENTICATOR,
  type CustomerAuthenticator,
} from "../customers/auth/customer-authenticator.js";
import {
  CUSTOMER_AUTH_CONFIG,
  type CustomerAuthConfig,
} from "../customers/auth/customer-auth-config.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { CheckoutService } from "./checkout.service.js";
import {
  checkoutBodySchema,
  checkoutResponseSchema,
  type CheckoutBody,
  type CheckoutResponse,
} from "./orders.schemas.js";

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Thin HTTP layer of the checkout (`POST /store/checkout`): find who is shopping, hand the request to the service, set
 * the status (201 new order, 200 replay). No rules here. Public: a signed-in customer's cart follows the session cookie,
 * everyone else's the `fluxkit_cart` cookie. Needs the store CSRF header (global guard); limited per address
 * (`checkout`); every response is `no-store` (middleware of `OrdersModule`).
 */
@StoreController("checkout")
export class CheckoutController {
  constructor(
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(CUSTOMER_AUTHENTICATOR) private readonly authenticator: CustomerAuthenticator,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly auth: CustomerAuthConfig,
    @Inject(CART_CONFIG) private readonly cartConfig: CartConfig,
  ) {}

  @Post()
  @RateLimit("checkout")
  @ApiOperation({
    summary: "Place the order of the cart",
    description:
      "One transaction, all or nothing: the stock of every line is reserved (30 minutes by default), the prices are read again, the totals are computed on the server, the order is stored with an immutable snapshot and the cart is emptied. `expectedTotal` is the total the shopper saw; if it differs, or a line became unavailable, the answer is 409 `cart_changed` with the fresh cart and nothing is reserved. A guest gets an `accessToken` once. The same `Idempotency-Key` with the same request returns the same order with 200 (a guest gets the SAME token as in the first answer); with another request it is 409 `idempotency_key_reused`. A customer or a guest email that already holds the most unpaid orders allowed (`MAX_OPEN_ORDERS`, 3 by default) gets 409 `too_many_open_orders` for a new order; a replay is answered even then.",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "A UUID the client generates for each checkout attempt.",
  })
  @ApiZodBody(checkoutBodySchema)
  @ApiZodResponse(201, checkoutResponseSchema, "The new order (and the access token of a guest).")
  @ApiZodResponse(200, checkoutResponseSchema, "The same checkout again: the order it created.")
  @ApiProblemResponses(400, 409, 429, 503)
  async place(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(checkoutBodySchema)) body: CheckoutBody,
  ): Promise<CheckoutResponse> {
    const shopper = await resolveShopper(this.authenticator, request);
    const outcome = await this.checkout.place({
      owner: shopper.owner,
      accountEmail: shopper.accountEmail,
      idempotencyKey,
      body,
    });
    response.status(outcome.status);
    if (
      outcome.status === 201 &&
      shopper.owner.kind === "guest" &&
      shopper.owner.token !== undefined
    ) {
      // The cart was written (emptied): its lifetime slides like after every cart write.
      setCartCookie(response, shopper.owner.token, {
        secure: this.auth.cookieSecure,
        maxAgeSeconds: this.cartConfig.ttlDays * SECONDS_PER_DAY,
      });
    }
    return outcome.response;
  }
}
