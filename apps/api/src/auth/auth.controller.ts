import { Body, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../common/openapi.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AdminPrincipal } from "./admin-authenticator.js";
import { AdminController } from "./admin-controller.decorator.js";
import { ADMIN_AUTH_CONFIG, type AdminAuthConfig } from "./auth-config.js";
import {
  changePasswordSchema,
  loginResponseSchema,
  loginSchema,
  meResponseSchema,
  type ChangePasswordBody,
  type LoginBody,
  type LoginResponse,
  type MeResponse,
} from "./auth.schemas.js";
import { AuthService } from "./auth.service.js";
import { CurrentAdmin } from "./current-admin.js";
import { AuthenticatedAdminRoute, PublicAdminRoute } from "./route-access.js";
import { clearSessionCookie, setSessionCookie } from "./session-cookie.js";
import { SessionService } from "./session.service.js";

/** Thin HTTP layer of the admin sign-in flow: validate, call the service, set or clear the cookie. No rules here. */
@AdminController("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly config: AdminAuthConfig,
  ) {}

  @Post("login")
  @PublicAdminRoute()
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in with email and password; sets the session cookie" })
  @ApiZodBody(loginSchema)
  @ApiZodResponse(
    200,
    loginResponseSchema,
    "The signed-in user. The session cookie is in `Set-Cookie`.",
  )
  @ApiProblemResponses(400, 429)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    // `request.ip` is the socket address unless Express `trust proxy` is set (see LoginThrottle).
    const result = await this.auth.login(body, request.ip ?? "unknown");
    setSessionCookie(response, result.token, {
      secure: this.config.cookieSecure,
      maxAgeSeconds: result.maxAgeSeconds,
    });
    return { user: result.user };
  }

  @Post("logout")
  @AuthenticatedAdminRoute()
  @HttpCode(204)
  @ApiOperation({ summary: "End the current session and clear the cookie" })
  @ApiNoContentResponse({ description: "The session is deleted; the old cookie no longer works." })
  async logout(
    @CurrentAdmin() admin: AdminPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeSession(admin.sessionId);
    clearSessionCookie(response, { secure: this.config.cookieSecure });
  }

  @Get("me")
  @AuthenticatedAdminRoute()
  @ApiOperation({ summary: "The signed-in user and the permissions of their role" })
  @ApiZodResponse(200, meResponseSchema, "The user and permissions, read from the database.")
  me(@CurrentAdmin() admin: AdminPrincipal): Promise<MeResponse> {
    return this.auth.me(admin);
  }

  @Post("change-password")
  @AuthenticatedAdminRoute()
  @HttpCode(204)
  @ApiOperation({ summary: "Change the own password; all other sessions end" })
  @ApiZodBody(changePasswordSchema)
  @ApiNoContentResponse({ description: "Password changed; the current session stays signed in." })
  @ApiProblemResponses(400)
  async changePassword(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordBody,
  ): Promise<void> {
    await this.auth.changePassword(admin, body);
  }
}
