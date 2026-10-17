import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  Patch,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import {
  CUSTOMER_AUTH_CONFIG,
  type CustomerAuthConfig,
} from "../customers/auth/customer-auth-config.js";
import { CustomerAuthenticated } from "../customers/auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../customers/auth/customer-authenticator.js";
import {
  clearCustomerSessionCookie,
  setCustomerSessionCookie,
} from "../customers/auth/customer-session-cookie.js";
import { CustomerSessionService } from "../customers/auth/customer-session.service.js";
import { CurrentCustomer } from "../customers/auth/current-customer.js";
import type { LoadedFeature } from "../features/feature-loader.js";

/**
 * TEST ONLY. Never imported from non-test code and excluded from the build (`tsconfig.build.json` skips `src/test`).
 * The register, login and account routes are step 3b; until then these probes stand in for them so the guard,
 * the cookie, the CSRF rule and the rate limit are proven end to end with real sessions.
 */

@Controller("store/probe-customer")
class CustomerProbeController {
  constructor(
    @Inject(CustomerSessionService) private readonly sessions: CustomerSessionService,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly config: CustomerAuthConfig,
  ) {}

  /** Marked: anonymous callers get 401. */
  @Get("me")
  @CustomerAuthenticated()
  me(@CurrentCustomer() customer: CustomerPrincipal): CustomerPrincipal {
    return customer;
  }

  @Post("write")
  @CustomerAuthenticated()
  write(@CurrentCustomer() customer: CustomerPrincipal): CustomerPrincipal {
    return customer;
  }

  /** Public: the store default. */
  @Get("public")
  publicRead(): { ok: true } {
    return { ok: true };
  }

  @Post("public-write")
  publicPost(): { ok: true } {
    return { ok: true };
  }

  @Put("public-write")
  publicPut(): { ok: true } {
    return { ok: true };
  }

  @Patch("public-write")
  publicPatch(): { ok: true } {
    return { ok: true };
  }

  @Delete("public-write")
  publicDelete(): { ok: true } {
    return { ok: true };
  }

  @Post("limited")
  @RateLimit("checkout")
  limited(): { ok: true } {
    return { ok: true };
  }

  /** Stands in for login: creates a session for the customer and sets the cookie exactly as 3b will. */
  @Post("sign-in")
  async signIn(
    @Body() body: { customerId: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ sessionId: string }> {
    const session = await this.sessions.create(body.customerId);
    setCustomerSessionCookie(response, session.token, {
      secure: this.config.cookieSecure,
      maxAgeSeconds: this.config.maxHours * 3600,
    });
    return { sessionId: session.sessionId };
  }

  @Post("sign-out")
  @CustomerAuthenticated()
  async signOut(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeSession(customer.sessionId);
    clearCustomerSessionCookie(response, { secure: this.config.cookieSecure });
  }
}

/** Class-level marking: every route of the controller is customer-authenticated. */
@Controller("store/probe-customer-class")
@CustomerAuthenticated()
class ClassMarkedProbeController {
  @Get("one")
  one(@CurrentCustomer() customer: CustomerPrincipal): CustomerPrincipal {
    return customer;
  }

  @Delete("two")
  two(@CurrentCustomer() customer: CustomerPrincipal): CustomerPrincipal {
    return customer;
  }
}

@Module({ controllers: [CustomerProbeController, ClassMarkedProbeController] })
class CustomerProbeModule {}

/** Extra feature for `startApp({ extraFeatures })`. */
export const customerProbeFeature: LoadedFeature[] = [
  { name: "customer-probe", module: CustomerProbeModule },
];

/** A route under `/store/account` that forgot `@CustomerAuthenticated()`: the route-walk test must catch it. */
@Controller("store/account")
class UnmarkedAccountProbeController {
  @Get("probe-unmarked")
  unmarked(): { leaked: true } {
    return { leaked: true };
  }
}

@Module({ controllers: [UnmarkedAccountProbeController] })
class UnmarkedAccountProbeModule {}

export const unmarkedAccountProbeFeature: LoadedFeature[] = [
  { name: "unmarked-account-probe", module: UnmarkedAccountProbeModule },
];
