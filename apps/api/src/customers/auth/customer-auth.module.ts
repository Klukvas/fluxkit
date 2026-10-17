import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CUSTOMER_AUTHENTICATOR } from "./customer-authenticator.js";
import { CUSTOMER_AUTH_CONFIG, type CustomerAuthConfig } from "./customer-auth-config.js";
import { CustomerSessionRepository } from "./customer-session.repository.js";
import { CustomerSessionService } from "./customer-session.service.js";
import { CustomerGuard } from "./customer.guard.js";
import { SessionCustomerAuthenticator } from "./session-customer-authenticator.js";
import { StoreCsrfGuard } from "./store-csrf.guard.js";

export interface CustomerAuthModuleOptions {
  config: CustomerAuthConfig;
}

/**
 * Customer authentication infrastructure (ADR 0016, plan step 3a): sessions, the authenticator, the guard behind
 * `@CustomerAuthenticated()` and the CSRF guard of the whole store. No routes yet (register, login and the rest are
 * step 3b). Global so that any store controller can use the decorator without importing this module. Needs `CLOCK`
 * and the database (`AuthModule`, `DatabaseModule`).
 */
@Global()
@Module({})
export class CustomerAuthModule {
  static register(options: CustomerAuthModuleOptions): DynamicModule {
    return {
      module: CustomerAuthModule,
      providers: [
        { provide: CUSTOMER_AUTH_CONFIG, useValue: options.config },
        CustomerSessionRepository,
        CustomerSessionService,
        SessionCustomerAuthenticator,
        { provide: CUSTOMER_AUTHENTICATOR, useExisting: SessionCustomerAuthenticator },
        CustomerGuard,
        // State-changing store requests need the CSRF header, signed in or not, whatever module serves them.
        { provide: APP_GUARD, useClass: StoreCsrfGuard },
      ],
      exports: [
        CUSTOMER_AUTHENTICATOR,
        CUSTOMER_AUTH_CONFIG,
        CustomerSessionService,
        CustomerGuard,
      ],
    };
  }
}
