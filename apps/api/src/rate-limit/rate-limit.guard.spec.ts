import { Controller, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { permissionsOf } from "@fluxkit/core";
import { setCurrentAdmin } from "../auth/current-admin.js";
import { ProblemException } from "../common/problem.js";
import { FakeClock } from "../test/fake-clock.js";
import { RateLimit } from "./rate-limit.decorator.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimiter } from "./rate-limiter.js";

@Controller("probe")
class ProbeController {
  @Post("limited")
  @RateLimit("checkout")
  limited(): string {
    return "ok";
  }

  @Post("upload")
  @RateLimit("mediaUpload")
  upload(): string {
    return "ok";
  }

  @Post("catalog")
  @RateLimit("catalogRead")
  catalog(): string {
    return "ok";
  }

  @Post("free")
  free(): string {
    return "ok";
  }
}

function contextFor(handler: () => string, ip: string | undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

function build() {
  const limiter = new RateLimiter(new FakeClock("2030-05-01T10:00:00.000Z"));
  return new RateLimitGuard(new Reflector(), limiter);
}

describe("RateLimitGuard", () => {
  it("lets the maximum through and answers 429 too_many_requests with Retry-After after that", () => {
    const guard = build();
    const context = contextFor(ProbeController.prototype.limited, "10.0.0.1");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
    let thrown: unknown;
    try {
      guard.canActivate(context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProblemException);
    const problem = thrown as ProblemException;
    expect(problem.code).toBe("too_many_requests");
    expect(problem.getStatus()).toBe(429);
    expect(problem.headers["Retry-After"]).toBe("600");
  });

  it("counts per client address", () => {
    const guard = build();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      guard.canActivate(contextFor(ProbeController.prototype.limited, "10.0.0.1"));
    }
    expect(guard.canActivate(contextFor(ProbeController.prototype.limited, "10.0.0.2"))).toBe(true);
  });

  it("an address that is missing is counted under one shared key, not skipped", () => {
    const guard = build();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      guard.canActivate(contextFor(ProbeController.prototype.limited, undefined));
    }
    expect(() =>
      guard.canActivate(contextFor(ProbeController.prototype.limited, undefined)),
    ).toThrow(ProblemException);
  });

  it("does nothing on a route without @RateLimit", () => {
    const guard = build();
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(guard.canActivate(contextFor(ProbeController.prototype.free, "10.0.0.1"))).toBe(true);
    }
  });
});

describe("RateLimitGuard keyed by the admin user (mediaUpload, ADR 0028)", () => {
  function uploadContext(ip: string, userId: string | undefined): ExecutionContext {
    const request = { ip };
    if (userId !== undefined) {
      setCurrentAdmin(request, {
        userId,
        email: `${userId}@example.test`,
        role: "manager",
        permissions: permissionsOf("manager"),
        sessionId: `session-${userId}`,
      });
    }
    return {
      getHandler: () => ProbeController.prototype.upload,
      getClass: () => ProbeController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function refusal(guard: RateLimitGuard, context: ExecutionContext): ProblemException {
    try {
      guard.canActivate(context);
    } catch (error) {
      if (error instanceof ProblemException) return error;
      throw error;
    }
    throw new Error("expected a 429");
  }

  it("allows 60 uploads per admin in 10 minutes, then 429 with Retry-After 600", () => {
    const guard = build();
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      expect(guard.canActivate(uploadContext("10.0.0.1", "admin-a")), `attempt ${attempt}`).toBe(
        true,
      );
    }
    const problem = refusal(guard, uploadContext("10.0.0.1", "admin-a"));
    expect(problem.getStatus()).toBe(429);
    expect(problem.code).toBe("too_many_requests");
    expect(problem.headers["Retry-After"]).toBe("600");
  });

  it("counts per admin user, not per address: another admin on the same address goes on, the same admin from elsewhere does not", () => {
    const guard = build();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      guard.canActivate(uploadContext("10.0.0.1", "admin-a"));
    }
    expect(guard.canActivate(uploadContext("10.0.0.1", "admin-b"))).toBe(true);
    expect(refusal(guard, uploadContext("10.9.9.9", "admin-a")).getStatus()).toBe(429);
  });

  it("does not share the window with the address limits of the same client", () => {
    const guard = build();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      guard.canActivate(contextFor(ProbeController.prototype.limited, "10.0.0.1"));
    }
    expect(guard.canActivate(uploadContext("10.0.0.1", "admin-a"))).toBe(true);
  });

  it("fails loudly (a server error, not a pass) on a user-keyed route without a signed-in admin", () => {
    const guard = build();
    expect(() => guard.canActivate(uploadContext("10.0.0.1", undefined))).toThrow(
      /signed-in admin/,
    );
    expect(() => guard.canActivate(uploadContext("10.0.0.1", undefined))).not.toThrow(
      ProblemException,
    );
  });
});

describe("RateLimitGuard counting only proxied requests (catalogRead)", () => {
  /** A request as Express sees it: `trust proxy` hops and the addresses taken from `X-Forwarded-For` (`request.ips`). */
  function catalogContext(request: {
    ip: string;
    ips: string[];
    trustProxy: unknown;
  }): ExecutionContext {
    const expressRequest = {
      ip: request.ip,
      ips: request.ips,
      app: {
        get: (setting: string) => (setting === "trust proxy" ? request.trustProxy : undefined),
      },
    };
    return {
      getHandler: () => ProbeController.prototype.catalog,
      getClass: () => ProbeController,
      switchToHttp: () => ({ getRequest: () => expressRequest }),
    } as unknown as ExecutionContext;
  }

  const throughEdge = (address: string) =>
    catalogContext({ ip: address, ips: [address], trustProxy: 1 });

  it("allows 300 reads a minute per forwarded address, then 429 with Retry-After 60", () => {
    const guard = build();
    for (let attempt = 1; attempt <= 300; attempt += 1) {
      expect(guard.canActivate(throughEdge("203.0.113.1")), `attempt ${attempt}`).toBe(true);
    }
    let thrown: unknown;
    try {
      guard.canActivate(throughEdge("203.0.113.1"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProblemException);
    expect((thrown as ProblemException).headers["Retry-After"]).toBe("60");
    expect(guard.canActivate(throughEdge("203.0.113.2"))).toBe(true);
  });

  it("does not count a request that bypassed the trusted proxies (the storefront's own server reads)", () => {
    const guard = build();
    const internal = catalogContext({ ip: "172.18.0.5", ips: [], trustProxy: 1 });
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      expect(guard.canActivate(internal)).toBe(true);
    }
  });

  it("counts every request by its socket address when no proxy is trusted", () => {
    const guard = build();
    const direct = catalogContext({ ip: "127.0.0.1", ips: [], trustProxy: 0 });
    for (let attempt = 0; attempt < 300; attempt += 1) {
      guard.canActivate(direct);
    }
    expect(() => guard.canActivate(direct)).toThrow(ProblemException);
  });

  it("counts the request when trust proxy is not a hop count (an unknown setting fails closed)", () => {
    const guard = build();
    const unusual = catalogContext({ ip: "10.1.1.1", ips: [], trustProxy: "loopback" });
    for (let attempt = 0; attempt < 300; attempt += 1) {
      guard.canActivate(unusual);
    }
    expect(() => guard.canActivate(unusual)).toThrow(ProblemException);
  });

  it("does not share the window with the search window or another address limit", () => {
    const guard = build();
    for (let attempt = 0; attempt < 300; attempt += 1) {
      guard.canActivate(throughEdge("203.0.113.9"));
    }
    expect(guard.canActivate(contextFor(ProbeController.prototype.limited, "203.0.113.9"))).toBe(
      true,
    );
  });
});
