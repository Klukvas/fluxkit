import { Body, Get, HttpCode, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { clearCartCookie, readCartCookie } from "../../cart/cart-cookie.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { CustomerAuthenticated } from "../auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../auth/customer-authenticator.js";
import { CUSTOMER_AUTH_CONFIG, type CustomerAuthConfig } from "../auth/customer-auth-config.js";
import {
  clearCustomerSessionCookie,
  readCustomerSessionCookie,
  setCustomerSessionCookie,
} from "../auth/customer-session-cookie.js";
import { CustomerSessionService } from "../auth/customer-session.service.js";
import { CurrentCustomer } from "../auth/current-customer.js";
import {
  accountResponseSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  signInResponseSchema,
  updateProfileSchema,
  type AccountResponse,
  type ChangePasswordBody,
  type LoginBody,
  type RegisterBody,
  type SignInResponse,
  type UpdateProfileBody,
} from "./account.schemas.js";
import { CustomerAccountService, type SignInResult } from "./account.service.js";

/**
 * Thin HTTP layer of the customer account (`/store/account`): validate, call the service, set or clear the cookie.
 * No rules here. Register and login are the only public routes; every other route is `@CustomerAuthenticated()`
 * and acts on the principal the guard produced, never on an id from the request. All responses are `no-store`
 * (middleware of `CustomersModule`).
 */
@StoreController("account")
export class AccountController {
  constructor(
    @Inject(CustomerAccountService) private readonly account: CustomerAccountService,
    @Inject(CustomerSessionService) private readonly sessions: CustomerSessionService,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly config: CustomerAuthConfig,
  ) {}

  @Post("register")
  @RateLimit("registration")
  @ApiOperation({
    summary: "Create an account and sign in",
    description:
      "Sets the session cookie. A taken email is 409 `conflict` on `email` (accepted while no email can be sent). A session cookie the request carried is revoked. The guest cart of the `fluxkit_cart` cookie is merged into the new account's cart and the cookie is cleared; `cartNotices` reports what the merge capped or dropped.",
  })
  @ApiZodBody(registerSchema)
  @ApiZodResponse(
    201,
    signInResponseSchema,
    "The new customer and the notices of the cart merge. The session cookie is in `Set-Cookie`.",
  )
  @ApiProblemResponses(400, 409, 429)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResponse> {
    const guestCartToken = readCartCookie(request.headers.cookie);
    const result = await this.account.register(
      body,
      readCustomerSessionCookie(request.headers.cookie),
      guestCartToken,
    );
    return this.withSessionCookie(response, result, request);
  }

  @Post("login")
  @RateLimit("login")
  @HttpCode(200)
  @ApiOperation({
    summary: "Sign in with email and password; sets the session cookie",
    description:
      "Every failure (unknown email, wrong password, locked or inactive account) is the same 401 and leaves the guest cart alone. 5 failures lock the account for 15 minutes. A session cookie the request carried is revoked and a new token is issued. On success the guest cart of the `fluxkit_cart` cookie is merged into the customer's cart and the cookie is cleared; `cartNotices` reports what the merge capped or dropped.",
  })
  @ApiZodBody(loginSchema)
  @ApiZodResponse(
    200,
    signInResponseSchema,
    "The customer and the notices of the cart merge. The session cookie is in `Set-Cookie`.",
  )
  @ApiProblemResponses(400, 401, 429)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResponse> {
    const guestCartToken = readCartCookie(request.headers.cookie);
    const result = await this.account.login(
      body,
      readCustomerSessionCookie(request.headers.cookie),
      guestCartToken,
    );
    return this.withSessionCookie(response, result, request);
  }

  @Post("logout")
  @CustomerAuthenticated()
  @HttpCode(204)
  @ApiOperation({ summary: "End the current session and clear the cookie" })
  @ApiNoContentResponse({ description: "The session is deleted; the old cookie no longer works." })
  @ApiProblemResponses(401)
  async logout(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeSession(customer.sessionId);
    clearCustomerSessionCookie(response, { secure: this.config.cookieSecure });
  }

  @Get("me")
  @CustomerAuthenticated()
  @ApiOperation({ summary: "The signed-in customer" })
  @ApiZodResponse(200, accountResponseSchema, "The own profile, read from the database.")
  @ApiProblemResponses(401)
  me(@CurrentCustomer() customer: CustomerPrincipal): Promise<AccountResponse> {
    return this.account.me(customer);
  }

  @Patch("me")
  @CustomerAuthenticated()
  @ApiOperation({
    summary: "Change the own names and phone",
    description: "The email is not editable. `phone: null` removes the phone.",
  })
  @ApiZodBody(updateProfileSchema)
  @ApiZodResponse(200, accountResponseSchema, "The updated profile.")
  @ApiProblemResponses(400, 401)
  updateMe(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileBody,
  ): Promise<AccountResponse> {
    return this.account.updateProfile(customer, body);
  }

  @Post("change-password")
  @CustomerAuthenticated()
  @HttpCode(204)
  @ApiOperation({ summary: "Change the own password; all other sessions end" })
  @ApiZodBody(changePasswordSchema)
  @ApiNoContentResponse({ description: "Password changed; the current session stays signed in." })
  @ApiProblemResponses(400, 401)
  async changePassword(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordBody,
  ): Promise<void> {
    await this.account.changePassword(customer, body);
  }

  /** Sets the session cookie and, when the request carried a guest cart cookie, clears it: that cart was merged. */
  private withSessionCookie(
    response: Response,
    result: SignInResult,
    request: Request,
  ): SignInResponse {
    setCustomerSessionCookie(response, result.token, {
      secure: this.config.cookieSecure,
      maxAgeSeconds: result.maxAgeSeconds,
    });
    if (readCartCookie(request.headers.cookie) !== undefined) {
      clearCartCookie(response, { secure: this.config.cookieSecure });
    }
    return { customer: result.customer, cartNotices: result.cartNotices };
  }
}
