import { Body, Get, HttpCode, Inject, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { pageSchema, type Page, type PaginationQuery } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AdminController } from "../admin-controller.decorator.js";
import { RequirePermission } from "../route-access.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  userResponseSchema,
  type CreateUserBody,
  type ResetPasswordBody,
  type UpdateUserBody,
  type UserResponse,
} from "./users.schemas.js";
import { UsersService } from "./users.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "User id." };

/**
 * Thin HTTP layer of user management. The permission is declared once on the controller: every route here needs
 * `users.manage` (owner only), and a new route added later is protected the same way. No DELETE route exists.
 */
@AdminController("users")
@RequirePermission("users.manage")
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List admin users, ordered by email" })
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(userResponseSchema), "A page of users.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: PaginationQuery,
  ): Promise<Page<UserResponse>> {
    return this.users.list(query);
  }

  @Post()
  @ApiOperation({ summary: "Create an admin user" })
  @ApiZodBody(createUserSchema)
  @ApiZodResponse(201, userResponseSchema, "The created user. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponse> {
    const created = await this.users.create(body);
    response.setHeader("Location", `/admin/users/${created.id}`);
    return created;
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one admin user" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, userResponseSchema, "The user.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<UserResponse> {
    return this.users.get(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Change the role or activity of a user",
    description:
      "Deactivating ends all sessions of the user. The last active owner cannot be demoted or deactivated (409 `rule_violation`).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateUserSchema)
  @ApiZodResponse(200, userResponseSchema, "The updated user.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserBody,
  ): Promise<UserResponse> {
    return this.users.update(id, body);
  }

  @Post(":id/reset-password")
  @HttpCode(204)
  @ApiOperation({
    summary: "Set a new password for a user",
    description: "Clears the lockout and ends all sessions of that user.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(resetPasswordSchema)
  @ApiNoContentResponse({
    description: "The password is changed and the user's sessions are gone.",
  })
  @ApiProblemResponses(400, 404)
  async resetPassword(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordBody,
  ): Promise<void> {
    await this.users.resetPassword(id, body);
  }
}
