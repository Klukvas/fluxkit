import { Body, Get, HttpCode, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { pageSchema, type Page } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import {
  customerDetailSchema,
  customerSummarySchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
  type CustomerDetail,
  type CustomerSummary,
  type ListCustomersQuery,
  type UpdateCustomerBody,
} from "./admin-customers.schemas.js";
import { AdminCustomersService } from "./admin-customers.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Customer id." };

/**
 * Thin HTTP layer of customer management. The default pair names the customer permissions: GET needs
 * `customers.read`, PATCH and POST need `customers.write` (a new route added later is protected the same way). The
 * viewer holds neither (personal data), manager and owner hold both. There is no DELETE and no password route.
 */
@AdminController("customers", { read: "customers.read", write: "customers.write" })
export class AdminCustomersController {
  constructor(@Inject(AdminCustomersService) private readonly customers: AdminCustomersService) {}

  @Get()
  @ApiOperation({ summary: "List customers, ordered by email" })
  @ApiPaginationQuery()
  @ApiQuery({
    name: "q",
    required: false,
    description: "Start of the email; case and surrounding spaces do not matter.",
    schema: { type: "string", maxLength: 254 },
  })
  @ApiZodResponse(200, pageSchema(customerSummarySchema), "A page of customers (summary fields).")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listCustomersQuerySchema)) query: ListCustomersQuery,
  ): Promise<Page<CustomerSummary>> {
    return this.customers.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one customer with the number of their orders" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, customerDetailSchema, "The customer.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<CustomerDetail> {
    return this.customers.get(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Activate or deactivate a customer",
    description:
      "Deactivating ends all sessions of the customer and refuses their sign-in. Nothing else can be changed.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateCustomerSchema)
  @ApiZodResponse(200, customerDetailSchema, "The updated customer.")
  @ApiProblemResponses(400, 404)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerBody,
  ): Promise<CustomerDetail> {
    return this.customers.update(id, body);
  }

  @Post(":id/unlock")
  @HttpCode(204)
  @ApiOperation({ summary: "Clear the lockout of a customer after too many failed sign-ins" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "The failure counter and the lock are cleared." })
  @ApiProblemResponses(400, 404)
  async unlock(@Param("id", uuidParam("id")) id: string): Promise<void> {
    await this.customers.unlock(id);
  }
}
