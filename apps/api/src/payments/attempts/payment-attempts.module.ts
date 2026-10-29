import { Module } from "@nestjs/common";
import { PaymentChanges } from "./payment-changes.js";
import { PaymentsRepository } from "./payments.repository.js";

/**
 * The payment tables and their single status writer (ADR 0032 decisions 2 and 5). Depends on the database only, so both
 * `OrdersModule` (the cancel, mark-paid and expiry guards, ADR 0032 decisions 8 and 10) and `PaymentsModule` (the flows)
 * import it without a cycle.
 */
@Module({
  providers: [PaymentsRepository, PaymentChanges],
  exports: [PaymentsRepository, PaymentChanges],
})
export class PaymentAttemptsModule {}
