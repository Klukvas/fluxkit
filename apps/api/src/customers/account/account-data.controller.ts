import { Get, Inject, Res } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import type { PersonalDataExport } from "@fluxkit/core";
import type { Response } from "express";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import {
  personalDataExportSchema,
  setExportHeaders,
} from "../../privacy/export/export-response.js";
import { PersonalDataExportService } from "../../privacy/export/personal-data-export.service.js";
import { CustomerAuthenticated } from "../auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../auth/customer-authenticator.js";
import { CurrentCustomer } from "../auth/current-customer.js";

/**
 * The signed-in customer's own personal data (ADR 0033 decisions 1, 7 and 13). The account surface owns the route; the
 * privacy services build the document. A guest token never exports: it opens one order, not a person's data.
 */
@StoreController("account")
export class AccountDataController {
  constructor(
    @Inject(PersonalDataExportService) private readonly exports: PersonalDataExportService,
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
}
