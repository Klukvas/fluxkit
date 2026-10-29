import { Body, Get, Headers, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CurrentCustomer } from "../../customers/auth/current-customer.js";
import { CustomerAuthenticated } from "../../customers/auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../../customers/auth/customer-authenticator.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import {
  customerCreatePaymentBodySchema,
  guestCreatePaymentBodySchema,
  guestPaymentStatusBodySchema,
  storeCreatedPaymentSchema,
  storePaymentStatusSchema,
  type CustomerCreatePaymentBody,
  type GuestCreatePaymentBody,
  type GuestPaymentStatusBody,
  type StoreCreatedPayment,
  type StorePaymentStatus,
} from "./store-payments.schemas.js";
import { StorePaymentsService } from "./store-payments.service.js";

const numberParam = new ZodValidationPipe(z.string().min(1).max(64), "number");
const paymentIdParam = new ZodValidationPipe(z.string().min(1).max(64), "paymentId");

const IDEMPOTENCY_HEADER = {
  name: "Idempotency-Key",
  required: true,
  description:
    "A UUID the client generates for each payment attempt. The same key again answers the same attempt (200) and never calls the provider twice; with another provider it is 409 `idempotency_key_reused`.",
} as const;

const CREATE_DESCRIPTION =
  "Starts an online payment attempt for an order that awaits payment (ADR 0032). The amount is the order total read by the server; the body takes no amount or currency (a strict body: any such member is a 400). The return and notification URLs are built from `STOREFRONT_PUBLIC_URL`, never from the request. 201 `{paymentId, status, redirectUrl, expiresAt}`: navigate to `redirectUrl` (the provider's page). A previous attempt that still waits for the shopper is replaced (its page stops working). 409 `rule_violation` with rule `order_not_payable`, `payment_in_progress` (a payment is processing, or the previous create's answer was lost), `payment_window_too_short` or `payment_not_available` (no online payment, or the order currency is not supported). 503 `payment_provider_unavailable` with `Retry-After` and `payment: {paymentId, status, canRetry}`: when `canRetry` is false the provider's answer was lost; do not start another attempt, poll the status instead (the attempt is settled by a webhook or the reconcile job). Limited per address (`paymentCreate`); `no-store`.";

/**
 * Thin HTTP layer of a guest's payment routes (`/store/orders/payments`). The number plus the access token open the
 * order exactly as for the order lookup (one identical 404); both are in the POST body, never in a URL. Store CSRF
 * header (global guard), limits per address, `no-store` (the orders middleware).
 */
@StoreController("orders")
export class StorePaymentsController {
  constructor(@Inject(StorePaymentsService) private readonly payments: StorePaymentsService) {}

  @Post("payments")
  @RateLimit("paymentCreate")
  @ApiOperation({
    summary: "Start the online payment of a guest order",
    description: CREATE_DESCRIPTION,
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiZodBody(guestCreatePaymentBodySchema)
  @ApiZodResponse(201, storeCreatedPaymentSchema, "The new attempt.")
  @ApiZodResponse(
    200,
    storeCreatedPaymentSchema,
    "The same Idempotency-Key again: the same attempt.",
  )
  @ApiProblemResponses(400, 404, 409, 429, 503)
  async create(
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(guestCreatePaymentBodySchema)) body: GuestCreatePaymentBody,
  ): Promise<StoreCreatedPayment> {
    const answer = await this.payments.createAsGuest(body, idempotencyKey);
    response.status(answer.status);
    return answer.body;
  }

  @Post("payments/status")
  @RateLimit("paymentStatus")
  @HttpCode(200)
  @ApiOperation({
    summary: "Read the state of a guest order's payment attempt",
    description:
      "For the storefront return page: `paymentId` (from the return URL) only says WHICH attempt to show; the state is the server's. While the attempt is not final the provider is read at most once per 10 s per attempt. Statuses are a small shopper-facing set (`waiting`, `processing`, `paid`, `failed`, `expired`), never provider data. 404 as for the order lookup, and for an attempt of another order. Limited per address (`paymentStatus`); `no-store`.",
  })
  @ApiZodBody(guestPaymentStatusBodySchema)
  @ApiZodResponse(200, storePaymentStatusSchema, "The attempt as the shop knows it now.")
  @ApiProblemResponses(400, 404, 429)
  status(
    @Body(new ZodValidationPipe(guestPaymentStatusBodySchema)) body: GuestPaymentStatusBody,
  ): Promise<StorePaymentStatus> {
    return this.payments.statusAsGuest(body.number, body.accessToken, body.paymentId);
  }
}

/**
 * Thin HTTP layer of a signed-in customer's payment routes (`/store/account/orders/{number}/payments`). The customer id
 * comes from the session; the owner filter is in SQL, so another customer's order is the same 404 as an unknown one.
 */
@StoreController("account/orders")
@CustomerAuthenticated()
export class AccountPaymentsController {
  constructor(@Inject(StorePaymentsService) private readonly payments: StorePaymentsService) {}

  @Post(":number/payments")
  @RateLimit("paymentCreate")
  @ApiOperation({
    summary: "Start the online payment of an own order",
    description: CREATE_DESCRIPTION,
  })
  @ApiParam({ name: "number", description: "The order number, `XXXX-XXXX`." })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiZodBody(customerCreatePaymentBodySchema)
  @ApiZodResponse(201, storeCreatedPaymentSchema, "The new attempt.")
  @ApiZodResponse(
    200,
    storeCreatedPaymentSchema,
    "The same Idempotency-Key again: the same attempt.",
  )
  @ApiProblemResponses(400, 401, 404, 409, 429, 503)
  async create(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Res({ passthrough: true }) response: Response,
    @Param("number", numberParam) number: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(customerCreatePaymentBodySchema)) body: CustomerCreatePaymentBody,
  ): Promise<StoreCreatedPayment> {
    const answer = await this.payments.createAsCustomer(
      customer.customerId,
      number,
      body,
      idempotencyKey,
    );
    response.status(answer.status);
    return answer.body;
  }

  @Get(":number/payments/:paymentId")
  @RateLimit("paymentStatus")
  @ApiOperation({
    summary: "Read the state of an own order's payment attempt",
    description:
      "As `POST /store/orders/payments/status` for a signed-in customer. 404 for another customer's order, an unknown number and an attempt of another order alike.",
  })
  @ApiParam({ name: "number", description: "The order number, `XXXX-XXXX`." })
  @ApiParam({ name: "paymentId", format: "uuid", description: "The payment attempt id." })
  @ApiZodResponse(200, storePaymentStatusSchema, "The attempt as the shop knows it now.")
  @ApiProblemResponses(400, 401, 404, 429)
  status(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param("number", numberParam) number: string,
    @Param("paymentId", paymentIdParam) paymentId: string,
  ): Promise<StorePaymentStatus> {
    return this.payments.statusAsCustomer(customer.customerId, number, paymentId);
  }
}
