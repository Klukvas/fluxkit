import { Body, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import type { Response } from "express";
import { CATALOG_LIMITS } from "@fluxkit/core";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import { RequirePermission } from "../../auth/route-access.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { adminPaymentSchema } from "../../orders/orders.schemas.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import {
  ADMIN_PAYMENTS_DEFAULT_PAGE_SIZE,
  adminPaymentListSchema,
  adminPaymentPageSchema,
  adminRefundResultSchema,
  listAdminPaymentsQuerySchema,
  refundPaymentSchema,
  type AdminPayment,
  type AdminPaymentList,
  type AdminPaymentPage,
  type AdminRefundResult,
  type ListAdminPaymentsQuery,
  type RefundPaymentBody,
} from "./admin-payments.schemas.js";
import { AdminPaymentsService } from "./admin-payments.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Order id." };
const PAYMENT_PARAM = { name: "paymentId", format: "uuid", description: "Payment attempt id." };

/**
 * Thin HTTP layer of the payments of an order (ADR 0032 decisions 11 and 18). The order permissions by default (GET
 * `orders.read`, POST `orders.write`: the resync); a refund moves money and needs `payments.refund` (owner and
 * manager; the viewer holds neither). The acting admin is read from the session, never from the request. Writes are
 * never retried here or by the client (ADR 0027): a lost refund answer is `unknown` and settled from the provider.
 */
@AdminController("orders", { read: "orders.read", write: "orders.write" })
export class AdminOrderPaymentsController {
  constructor(@Inject(AdminPaymentsService) private readonly payments: AdminPaymentsService) {}

  @Get(":id/payments")
  @ApiOperation({
    summary: "List the payment attempts of an order",
    description:
      "Every online payment attempt of the order, oldest first, with its refunds, journal and attention flag (the same view as `payments` of `GET /admin/orders/{id}`). No page URL; card data is the card system and the last four digits only.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, adminPaymentListSchema, "The attempts.")
  @ApiProblemResponses(400, 404)
  list(@Param("id", uuidParam("id")) id: string): Promise<AdminPaymentList> {
    return this.payments.listForOrder(id);
  }

  @Post(":id/payments/:paymentId/refunds")
  @RequirePermission("payments.refund")
  @RateLimit("paymentRefund")
  @ApiOperation({
    summary: "Refund a payment, fully or partly",
    description:
      "Only a `succeeded` attempt; `amount` (minor units, the payment currency) at most `refundableAmount` (the amount less every refund that is not `failed`; checked under the payment row lock, so two admins can never refund more than was paid); a partial amount only when the provider takes partial refunds. The refund is stored `requested`, then sent once to the provider with no transaction open (our refund id is the provider's idempotency reference). 202 `{refund, payment}` with the refund as the provider left it (`succeeded`, `processing`, `failed`, `requested` when the provider throttled us and the reconcile job sends it, `unknown` when the answer was lost: never resent, settled from the provider's refund list). A refund never changes the order status. The same `Idempotency-Key` with the same body answers the same refund (200) without a second call; with another body 409 `idempotency_key_reused`. 409 `rule_violation` with rule `refund_not_allowed`, `refund_exceeds_remaining` or `partial_refund_not_supported`. Limited per admin user (`paymentRefund`).",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(PAYMENT_PARAM)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "A UUID the admin client generates for each refund the admin confirms.",
  })
  @ApiZodBody(refundPaymentSchema)
  @ApiZodResponse(202, adminRefundResultSchema, "The refund was requested and sent.")
  @ApiZodResponse(200, adminRefundResultSchema, "The same Idempotency-Key again: the same refund.")
  @ApiProblemResponses(400, 404, 409, 429)
  async refund(
    @Res({ passthrough: true }) response: Response,
    @Param("id", uuidParam("id")) id: string,
    @Param("paymentId", uuidParam("paymentId")) paymentId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(refundPaymentSchema)) body: RefundPaymentBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminRefundResult> {
    const answer = await this.payments.refund(id, paymentId, admin.userId, body, idempotencyKey);
    response.status(answer.status);
    return answer.body;
  }

  @Post(":id/payments/:paymentId/resync")
  @HttpCode(200)
  @RateLimit("paymentResync")
  @ApiOperation({
    summary: "Read a payment's status from the provider now",
    description:
      "What the reconcile job does for one attempt, now: one status read (10 s limit), applied like a webhook (a success pays the order, a late one is refunded automatically). An attempt without a provider id has nothing to read and is answered as stored. 503 `payment_provider_unavailable` with `Retry-After` when the provider refused or did not answer (nothing changed); 409 `rule_violation` `payment_not_available` when the attempt's provider is no longer enabled. Limited per admin user (`paymentResync`).",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(PAYMENT_PARAM)
  @ApiZodResponse(200, adminPaymentSchema, "The attempt afterwards.")
  @ApiProblemResponses(400, 404, 409, 429, 503)
  resync(
    @Param("id", uuidParam("id")) id: string,
    @Param("paymentId", uuidParam("paymentId")) paymentId: string,
  ): Promise<AdminPayment> {
    return this.payments.resync(id, paymentId);
  }
}

/**
 * The shop-wide payment routes (ADR 0032 decision 18): the attention list (`orders.read`) and clearing an attention
 * item (`payments.refund`, journaled with the admin).
 */
@AdminController("payments", { read: "orders.read", write: "payments.refund" })
export class AdminPaymentsController {
  constructor(@Inject(AdminPaymentsService) private readonly payments: AdminPaymentsService) {}

  @Get()
  @ApiOperation({
    summary: "List payment attempts, newest first",
    description:
      "`needsAttention=true` lists the open attention items (late or duplicate successes, refunds that failed or are unknown, amount mismatches, unknown provider statuses, reads that gave up); `false` the others; missing means all. Keyset paging: pass `nextCursor` as `cursor`.",
  })
  @ApiQuery({
    name: "needsAttention",
    required: false,
    schema: { type: "string", enum: ["true", "false"] },
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: {
      type: "integer",
      minimum: 1,
      maximum: CATALOG_LIMITS.maxPageSize,
      default: ADMIN_PAYMENTS_DEFAULT_PAGE_SIZE,
    },
  })
  @ApiQuery({ name: "cursor", required: false, schema: { type: "string", maxLength: 200 } })
  @ApiZodResponse(200, adminPaymentPageSchema, "A page of attempts with their order numbers.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listAdminPaymentsQuerySchema)) query: ListAdminPaymentsQuery,
  ): Promise<AdminPaymentPage> {
    return this.payments.list(query);
  }

  @Post(":paymentId/attention/clear")
  @HttpCode(200)
  @ApiOperation({
    summary: "Close the attention item of a payment",
    description:
      "After an admin settled the case (for example refunded by hand): `needsAttention` becomes false, `attentionCode` stays as a record, and the journal names the admin (`action: attention_cleared`). No body (the journal has no note column; ADR 0032 named a note). An attempt without an open item is answered unchanged.",
  })
  @ApiParam(PAYMENT_PARAM)
  @ApiZodResponse(200, adminPaymentSchema, "The attempt afterwards.")
  @ApiProblemResponses(400, 404)
  clear(
    @Param("paymentId", uuidParam("paymentId")) paymentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminPayment> {
    return this.payments.clearAttention(paymentId, admin.userId);
  }
}
