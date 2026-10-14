import { Controller, Get, Inject, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type pg from "pg";
import { PG_POOL } from "../database/database.module.js";

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
      await this.pool.query("select 1");
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
