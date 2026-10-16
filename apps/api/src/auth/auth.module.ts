import {
  Global,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { adminNoStoreMiddleware } from "./admin-no-store.middleware.js";
import { ADMIN_AUTHENTICATOR, type AdminAuthenticator } from "./admin-authenticator.js";
import { AdminGuard, AdminPathGuard } from "./admin.guard.js";
import { AdminUserRepository } from "./admin-user.repository.js";
import { ADMIN_AUTH_CONFIG, type AdminAuthConfig } from "./auth-config.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { CLOCK, SystemClock, type Clock } from "./clock.js";
import { LoginThrottle } from "./login-throttle.js";
import { PasswordHasher, type ScryptParams } from "./password-hasher.js";
import { SessionAdminAuthenticator } from "./session-admin-authenticator.js";
import { ExpiredSessionCleanup } from "./session-cleanup.js";
import { SessionRepository } from "./session.repository.js";
import { SessionService } from "./session.service.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

export interface AuthModuleOptions {
  config: AdminAuthConfig;
  /** Tests only: replaces the session-based authenticator. */
  authenticator?: AdminAuthenticator;
  /** Tests only: a controlled clock for session expiry. */
  clock?: Clock;
  /** Tests only: cheap scrypt parameters. */
  scrypt?: ScryptParams;
  /**
   * Delete expired sessions when the application starts. Default true; command-line tools (`admin:create`,
   * `admin:unlock`, `seed`) pass false because they must change nothing but their own target.
   */
  cleanExpiredSessionsOnBootstrap?: boolean;
}

/** Global so that any admin controller can use `AdminGuard` without importing this module. */
@Global()
@Module({})
export class AuthModule implements NestModule {
  /** `Cache-Control: no-store` on every `/admin` response; the path test is inside, so it matches like the guard. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(adminNoStoreMiddleware)
      .forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }

  static register(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController, UsersController],
      providers: [
        { provide: ADMIN_AUTH_CONFIG, useValue: options.config },
        { provide: CLOCK, useValue: options.clock ?? new SystemClock() },
        { provide: PasswordHasher, useFactory: () => new PasswordHasher(options.scrypt) },
        {
          provide: LoginThrottle,
          useFactory: (clock: Clock) => new LoginThrottle(clock),
          inject: [CLOCK],
        },
        SessionRepository,
        SessionService,
        ...(options.cleanExpiredSessionsOnBootstrap === false ? [] : [ExpiredSessionCleanup]),
        AdminUserRepository,
        AuthService,
        UsersService,
        SessionAdminAuthenticator,
        options.authenticator === undefined
          ? { provide: ADMIN_AUTHENTICATOR, useExisting: SessionAdminAuthenticator }
          : { provide: ADMIN_AUTHENTICATOR, useValue: options.authenticator },
        AdminGuard,
        // Default deny for everything under /admin, whether or not the controller uses @AdminController.
        { provide: APP_GUARD, useClass: AdminPathGuard },
      ],
      exports: [
        ADMIN_AUTHENTICATOR,
        ADMIN_AUTH_CONFIG,
        CLOCK,
        PasswordHasher,
        SessionService,
        AdminGuard,
      ],
    };
  }
}
