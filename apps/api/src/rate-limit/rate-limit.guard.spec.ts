import { Controller, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
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
