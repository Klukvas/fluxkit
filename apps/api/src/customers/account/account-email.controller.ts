import { Body, HttpCode, Inject, Post, SetMetadata, UseGuards } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation } from "@nestjs/swagger";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { RateLimitGuard } from "../../rate-limit/rate-limit.guard.js";
import { RATE_LIMIT_KEY, type RateLimitName } from "../../rate-limit/rate-limiter.js";
import { CustomerAuthenticated } from "../auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../auth/customer-authenticator.js";
import { CurrentCustomer } from "../auth/current-customer.js";
import {
  passwordResetAcceptedSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  verifyEmailSchema,
  type PasswordResetAccepted,
  type PasswordResetConfirmBody,
  type PasswordResetRequestBody,
  type VerifyEmailBody,
} from "./account-email.schemas.js";
import { AccountEmailService } from "./account-email.service.js";
import { EmailDeliveryGuard } from "./email-delivery.guard.js";

/** A public mail route: off (404) without a provider, then the named per-address limit, in that order. */
const PublicEmailRoute = (limit: RateLimitName): MethodDecorator =>
  ((target, key, descriptor) => {
    SetMetadata(RATE_LIMIT_KEY, limit)(target, key, descriptor);
    UseGuards(EmailDeliveryGuard, RateLimitGuard)(target, key, descriptor);
  }) as MethodDecorator;

const OFF_WITHOUT_PROVIDER =
  "Answers 404 (as an unknown route) when no email provider is configured (`EMAIL_PROVIDER=none`; `GET /store/config` says `emailDelivery: false`).";

/**
 * Password reset and email verification of customer accounts (`/store/account`, ADR 0031 decisions 10, 11 and 16). Thin:
 * validate the structure, call the service. Three routes are public on purpose (the person is signed out, or the link was
 * opened in another browser) and listed by name in the route walk (`customer-routes.spec.ts`); the resend is signed in.
 * All answers are `no-store` (middleware of `CustomersModule`); the CSRF header is required as on every store write.
 */
@StoreController("account")
export class AccountEmailController {
  constructor(@Inject(AccountEmailService) private readonly service: AccountEmailService) {}

  @Post("password-reset")
  @PublicEmailRoute("passwordReset")
  @HttpCode(202)
  @ApiOperation({
    summary: "Ask for a password reset link by email",
    description: `Always the same \`202 {}\`, with the same headers and no sooner than 400 ms after the request arrived, whether or not an account has this email, is active or is locked: an active account gets a mail with a link valid 60 minutes (\`{STOREFRONT_PUBLIC_URL}/{locale}/account/reset-password#t=<token>\`), an unknown address gets nothing. At most 3 links per account per hour (over it: the same answer, no mail). \`locale\` (one of \`LOCALES\`) is the language of the mail. 400 only for a malformed email or locale; 429 per client address and per requested email. ${OFF_WITHOUT_PROVIDER}`,
  })
  @ApiZodBody(passwordResetRequestSchema)
  @ApiZodResponse(202, passwordResetAcceptedSchema, "Accepted; says nothing about the account.")
  @ApiProblemResponses(400, 404, 429)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestBody,
  ): Promise<PasswordResetAccepted> {
    // The floor starts when the handler starts: the guards before it do the same work for every address.
    const startedAt = performance.now();
    await this.service.requestPasswordReset(body, startedAt);
    return {};
  }

  @Post("password-reset/confirm")
  @PublicEmailRoute("passwordResetConfirm")
  @HttpCode(204)
  @ApiOperation({
    summary: "Set a new password with the token of a reset link",
    description: `Every token problem (unknown, used, expired, replaced by a newer link, another purpose, the account deactivated) is the same 400 \`validation_failed\` at \`token\` with code \`invalid_or_expired\`. The new password follows the registration policy (400 at \`newPassword\`). On success every session of the customer ends, a lockout is cleared, the link stops working and a "password changed" mail is sent; nobody is signed in. ${OFF_WITHOUT_PROVIDER}`,
  })
  @ApiZodBody(passwordResetConfirmSchema)
  @ApiNoContentResponse({ description: "Password changed; sign in with it." })
  @ApiProblemResponses(400, 404, 429)
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirmBody,
  ): Promise<void> {
    await this.service.confirmPasswordReset(body);
  }

  @Post("verify-email")
  @PublicEmailRoute("passwordResetConfirm")
  @HttpCode(204)
  @ApiOperation({
    summary: "Confirm the account's email address with the token of a verification link",
    description: `Sets \`emailVerified\`. Every token problem is the same 400 \`validation_failed\` at \`token\` with code \`invalid_or_expired\`; a link of a customer who is already verified answers 204 again. Shares the per-address limit with the reset confirmation. ${OFF_WITHOUT_PROVIDER}`,
  })
  @ApiZodBody(verifyEmailSchema)
  @ApiNoContentResponse({ description: "The email address is verified." })
  @ApiProblemResponses(400, 404, 429)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailBody,
  ): Promise<void> {
    await this.service.verifyEmail(body);
  }

  @Post("verify-email/resend")
  @UseGuards(EmailDeliveryGuard)
  @CustomerAuthenticated()
  @HttpCode(204)
  @ApiOperation({
    summary: "Send the signed-in customer a new verification link",
    description: `The mail is in \`DEFAULT_LOCALE\`; the link is valid 48 hours and the older link stops working. 409 \`rule_violation\` \`already_verified\` for a verified address; at most 3 per customer per hour (429). Takes no body members. Anonymous callers get 401; ${OFF_WITHOUT_PROVIDER}`,
  })
  @ApiNoContentResponse({ description: "A new verification mail is on its way." })
  @ApiProblemResponses(400, 401, 404, 409, 429)
  async resendVerification(@CurrentCustomer() customer: CustomerPrincipal): Promise<void> {
    await this.service.resendVerification(customer);
  }
}
