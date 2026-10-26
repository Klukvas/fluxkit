import { Module } from "@nestjs/common";
import { CustomerAuthTokenRepository } from "./customer-auth-token.repository.js";
import { CustomerAuthTokens } from "./customer-auth-tokens.service.js";

/**
 * Customer auth tokens (ADR 0031 decision 9): issue, evaluate, consume and invalidate password reset and email
 * verification tokens. Imported by `CustomersModule` (the account routes, registration, password change and
 * deactivation). Needs the globals of the database and `EmailOutboxModule` (the outbox and the delivery config).
 */
@Module({
  providers: [CustomerAuthTokenRepository, CustomerAuthTokens],
  exports: [CustomerAuthTokens],
})
export class EmailAuthModule {}
