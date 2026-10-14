import { Controller, Get, Inject, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type pg from "pg";
import { PG_POOL } from "../database/database.module.js";

const HEALTH_QUERY_TIMEOUT_MS = 3000;

/** Rejects if the promise does not settle in time, so a silent database cannot hang the endpoint. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Database did not answer within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get()
  @ApiOkResponse({ description: "Service and database are reachable." })
  @ApiServiceUnavailableResponse({ description: "Database is not reachable." })
  async check(): Promise<{ status: "ok" }> {
    try {
      await withTimeout(this.pool.query("select 1"), HEALTH_QUERY_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(
        "Database health check failed",
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        { status: "error", database: "unreachable" },
        { cause: error },
      );
    }
    return { status: "ok" };
  }
}
