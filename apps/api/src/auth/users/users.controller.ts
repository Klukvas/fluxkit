import { Body, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { pageSchema, type Page, type PaginationQuery } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import type { AdminPrincipal } from "../admin-authenticator.js";
import { AdminController } from "../admin-controller.decorator.js";
import { CurrentAdmin } from "../current-admin.js";
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
import { UsersService, type UserActor } from "./users.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "User id." };

/** The password re-entry of the owner operations: what it answers, in one sentence per route. */
const STEP_UP_ERRORS =
  "Asks for the signed-in admin's `currentPassword` (`400` on `currentPassword` when it is missing, `403` with `rule: current_password_incorrect` when it is wrong, `429` when the five attempts per 15 minutes are spent, `503` with `rule: step_up_unavailable` while the shared limits cannot be reached).";

function actorOf(principal: AdminPrincipal, request: Request): UserActor {
  // `request.ip` is the socket address unless Express `trust proxy` is set (`TRUST_PROXY`).
  return { principal, clientAddress: request.ip ?? "unknown" };
}

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
  @ApiOperation({
    summary: "Create an admin user",
    description: `Creating an OWNER needs the actor's current password (ADR 0058). ${STEP_UP_ERRORS}`,
  })
  @ApiZodBody(createUserSchema)
  @ApiZodResponse(201, userResponseSchema, "The created user. `Location` points to it.")
  @ApiProblemResponses(400, 403, 409, 429, 503)
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserBody,
    @Res({ passthrough: true }) response: Response,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<UserResponse> {
    const created = await this.users.create(body, actorOf(admin, request));
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
    description: `Deactivating ends all sessions of the user. The last active owner cannot be demoted or deactivated (409 \`rule_violation\`). Promoting a non-owner to owner and reactivating an inactive owner need the actor's current password (ADR 0058); when the locked user makes that true only after the request was sent, the answer is \`409 rule_violation\` with \`rule: owner_step_up_required\` and nothing changes. ${STEP_UP_ERRORS}`,
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateUserSchema)
  @ApiZodResponse(200, userResponseSchema, "The updated user.")
  @ApiProblemResponses(400, 403, 404, 409, 429, 503)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<UserResponse> {
    return this.users.update(id, body, actorOf(admin, request));
  }

  @Post(":id/reset-password")
  @HttpCode(204)
  @ApiOperation({
    summary: "Set a new password for a user",
    description: `Clears the lockout and ends all sessions of that user. An OWNER target, the actor themselves included, needs the actor's current password (ADR 0058); when the locked user is an owner only after the request was sent, the answer is \`409 rule_violation\` with \`rule: owner_step_up_required\` and the password stays. ${STEP_UP_ERRORS}`,
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(resetPasswordSchema)
  @ApiNoContentResponse({
    description: "The password is changed and the user's sessions are gone.",
  })
  @ApiProblemResponses(400, 403, 404, 409, 429, 503)
  async resetPassword(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    await this.users.resetPassword(id, body, actorOf(admin, request));
  }
}
