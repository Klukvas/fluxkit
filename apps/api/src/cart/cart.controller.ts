import {
  Body,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
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
import { CART_CONFIG, type CartConfig } from "./cart-config.js";
import { clearCartCookie, readCartCookie, setCartCookie } from "./cart-cookie.js";
import {
  addCartItemSchema,
  cartQuerySchema,
  cartSchema,
  setCartItemQuantitySchema,
  type AddCartItemBody,
  type CartQuery,
  type CartResponse,
  type SetCartItemQuantityBody,
} from "./cart.schemas.js";
import { CartService, type CartCookieDirective, type CartOwner } from "./cart.service.js";

const SECONDS_PER_DAY = 24 * 60 * 60;
const variantIdParam = new ZodValidationPipe(z.string().min(1).max(64), "variantId");
const LOCALE_QUERY = { name: "locale", required: false, schema: { type: "string" } } as const;

/**
 * Thin HTTP layer of the cart (`/store/cart`): find who is asking, validate, call the service, apply its cookie
 * decision. No rules here. The routes are public: a signed-in customer's cart follows the session cookie, everyone else's
 * the `fluxkit_cart` cookie; nothing in a URL, query or body names a cart. Writes are limited per address
 * (`cartWrite`), need the store CSRF header (global guard) and every response is `no-store` (middleware of `CartModule`).
 */
@StoreController("cart")
export class CartController {
  constructor(
    @Inject(CartService) private readonly cart: CartService,
    @Inject(CUSTOMER_AUTHENTICATOR) private readonly authenticator: CustomerAuthenticator,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly auth: CustomerAuthConfig,
    @Inject(CART_CONFIG) private readonly config: CartConfig,
  ) {}

  @Get()
  @ApiOperation({
    summary: "The current cart, repriced with the current catalog prices",
    description:
      "An empty cart when there is none; a read never creates a cart or a cookie. The cart is found through the customer session cookie, else the `fluxkit_cart` cookie.",
  })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodResponse(200, cartSchema, "The cart.")
  @ApiProblemResponses(409)
  async read(
    @Req() request: Request,
    @Query(new ZodValidationPipe(cartQuerySchema)) query: CartQuery,
  ): Promise<CartResponse> {
    return (await this.cart.read(await this.ownerOf(request), query.locale)).cart;
  }

  @Post("items")
  @RateLimit("cartWrite")
  @HttpCode(200)
  @ApiOperation({
    summary: "Add a variant to the cart, or add to the quantity of its line",
    description:
      "The first write of a guest creates the cart and sets the `fluxkit_cart` cookie. The line keeps the current unit price as the price the shopper has seen. A cart holds no stock.",
  })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodBody(addCartItemSchema)
  @ApiZodResponse(200, cartSchema, "The cart after the change.")
  @ApiProblemResponses(400, 404, 409, 429)
  async addItem(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemBody,
    @Query(new ZodValidationPipe(cartQuerySchema)) query: CartQuery,
  ): Promise<CartResponse> {
    return this.respond(
      response,
      await this.cart.addItem(await this.ownerOf(request), body, query.locale),
    );
  }

  @Patch("items/:variantId")
  @RateLimit("cartWrite")
  @ApiOperation({ summary: "Set the quantity of a cart line" })
  @ApiParam({ name: "variantId", description: "The variant of the line." })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodBody(setCartItemQuantitySchema)
  @ApiZodResponse(200, cartSchema, "The cart after the change.")
  @ApiProblemResponses(400, 404, 409, 429)
  async setQuantity(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("variantId", variantIdParam) variantId: string,
    @Body(new ZodValidationPipe(setCartItemQuantitySchema)) body: SetCartItemQuantityBody,
    @Query(new ZodValidationPipe(cartQuerySchema)) query: CartQuery,
  ): Promise<CartResponse> {
    return this.respond(
      response,
      await this.cart.setQuantity(await this.ownerOf(request), variantId, body, query.locale),
    );
  }

  @Delete("items/:variantId")
  @RateLimit("cartWrite")
  @ApiOperation({ summary: "Remove a line from the cart" })
  @ApiParam({ name: "variantId", description: "The variant of the line." })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodResponse(200, cartSchema, "The cart after the change.")
  @ApiProblemResponses(404, 409, 429)
  async removeItem(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("variantId", variantIdParam) variantId: string,
    @Query(new ZodValidationPipe(cartQuerySchema)) query: CartQuery,
  ): Promise<CartResponse> {
    return this.respond(
      response,
      await this.cart.removeItem(await this.ownerOf(request), variantId, query.locale),
    );
  }

  @Delete()
  @RateLimit("cartWrite")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete the cart",
    description:
      "Deletes the cart and clears the `fluxkit_cart` cookie. The next add starts a new cart. Creates nothing.",
  })
  @ApiNoContentResponse({ description: "The cart is gone (or there was none)." })
  @ApiProblemResponses(429)
  async clear(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.applyCookie(response, await this.cart.clear(await this.ownerOf(request)));
  }

  @Post("acknowledge")
  @RateLimit("cartWrite")
  @HttpCode(200)
  @ApiOperation({
    summary: "Accept the current prices",
    description:
      "Marks the current unit price of every available line as seen, which ends its `price_changed` notice. Unavailable lines are unchanged.",
  })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodResponse(200, cartSchema, "The cart after the change.")
  @ApiProblemResponses(400, 409, 429)
  async acknowledge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query(new ZodValidationPipe(cartQuerySchema)) query: CartQuery,
  ): Promise<CartResponse> {
    return this.respond(
      response,
      await this.cart.acknowledge(await this.ownerOf(request), query.locale),
    );
  }

  /** The signed-in customer if the session cookie is valid, else the guest of the cart cookie. Never a request field. */
  private async ownerOf(request: Request): Promise<CartOwner> {
    const principal = await this.authenticator.authenticate(request);
    return principal === undefined
      ? { kind: "guest", token: readCartCookie(request.headers.cookie) }
      : { kind: "customer", customerId: principal.customerId };
  }

  private respond(
    response: Response,
    outcome: { cart: CartResponse; cookie: CartCookieDirective },
  ): CartResponse {
    this.applyCookie(response, outcome.cookie);
    return outcome.cart;
  }

  private applyCookie(response: Response, directive: CartCookieDirective): void {
    if (directive.action === "set") {
      setCartCookie(response, directive.token, {
        secure: this.auth.cookieSecure,
        maxAgeSeconds: this.config.ttlDays * SECONDS_PER_DAY,
      });
    } else if (directive.action === "clear") {
      clearCartCookie(response, { secure: this.auth.cookieSecure });
    }
  }
}
