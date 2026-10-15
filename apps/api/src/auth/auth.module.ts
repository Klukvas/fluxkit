import { Global, Module, type DynamicModule } from "@nestjs/common";
import {
  ADMIN_AUTHENTICATOR,
  DenyAllAdminAuthenticator,
  type AdminAuthenticator,
} from "./admin-authenticator.js";
import { AdminGuard } from "./admin.guard.js";

/** Global so that any admin controller can use `AdminGuard` without importing this module. */
@Global()
@Module({})
export class AuthModule {
  /** `authenticator` is for tests only (the auth plan will replace the default provider instead). */
  static register(authenticator?: AdminAuthenticator): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        authenticator === undefined
          ? { provide: ADMIN_AUTHENTICATOR, useClass: DenyAllAdminAuthenticator }
          : { provide: ADMIN_AUTHENTICATOR, useValue: authenticator },
        AdminGuard,
      ],
      exports: [ADMIN_AUTHENTICATOR, AdminGuard],
    };
  }
}
