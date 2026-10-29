import { Body, Get, HttpCode, Inject, Post, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation } from "@nestjs/swagger";
import type { PersonalDataExport } from "@fluxkit/core";
import type { Response } from "express";
import { z } from "zod";
import { MAX_CREDENTIAL_LENGTH } from "../../auth/auth.schemas.js";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import {
  personalDataExportSchema,
  setExportHeaders,
} from "../../privacy/export/export-response.js";
import { PersonalDataExportService } from "../../privacy/export/personal-data-export.service.js";
import { CUSTOMER_AUTH_CONFIG, type CustomerAuthConfig } from "../auth/customer-auth-config.js";
import { CustomerAuthenticated } from "../auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../auth/customer-authenticator.js";
import { clearCustomerSessionCookie } from "../auth/customer-session-cookie.js";
import { CurrentCustomer } from "../auth/current-customer.js";
import { AccountDeletionService } from "./account-deletion.service.js";

/** `POST /store/account/delete`: the current password and an explicit `confirm: true`. */
export const deleteAccountSchema = z.strictObject({
  password: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
  confirm: z.literal(true).meta({
    description: "Must be true: the deletion is immediate and cannot be undone.",
  }),
});
export type DeleteAccountBody = z.output<typeof deleteAccountSchema>;

/**
 * The signed-in customer's own personal data (ADR 0033 decisions 1, 6, 7 and 13): the export and the account deletion.
 * The account surface owns the routes; the privacy services build the document and run the erasure. A guest token never
 * exports or deletes: it opens one order, not a person's data.
 */
@StoreController("account")
export class AccountDataController {
  constructor(
    @Inject(PersonalDataExportService) private readonly exports: PersonalDataExportService,
    @Inject(AccountDeletionService) private readonly deletion: AccountDeletionService,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly config: CustomerAuthConfig,
  ) {}

  @Get("data-export")
  @CustomerAuthenticated()
  @ApiOperation({
    summary: "Download my personal data",
    description:
      "JSON document `fluxkit.personal-data-export/v1` as an attachment: the account, every order of the account or with its email, mails, sessions, the cart and the providers the shop uses. At most 5 per customer per 24 hours (`429`); `409 rule_violation` `export_too_large` above 10 000 orders.",
  })
  @ApiZodResponse(
    200,
    personalDataExportSchema,
    "The document (`Content-Disposition: attachment`).",
  )
  @ApiProblemResponses(401, 409, 429)
  async dataExport(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PersonalDataExport> {
    const document = await this.exports.selfService(customer.customerId);
    setExportHeaders(response, document);
    return document;
  }

  @Post("delete")
  @CustomerAuthenticated()
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete my account now",
    description:
      "Needs the current password and `confirm: true`. Deletes the account, its sessions, cart and tokens and the mails to it; the orders stay as accounting records with their contact data anonymised (ADR 0033). Refused with `409 rule_violation` `erasure_blocked` (members `reasons`, `blockers`) while an order, payment, refund, shipment or mail is in progress; nothing changes then. A wrong password is `400` on `password` (`incorrect`) and counts as a failed sign-in. At most 5 per customer per hour.",
  })
  @ApiZodBody(deleteAccountSchema)
  @ApiNoContentResponse({ description: "The account is gone and the session cookie is cleared." })
  @ApiProblemResponses(400, 401, 409, 429)
  async deleteAccount(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodValidationPipe(deleteAccountSchema)) body: DeleteAccountBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.deletion.deleteAccount(customer.customerId, body.password);
    clearCustomerSessionCookie(response, { secure: this.config.cookieSecure });
  }
}
