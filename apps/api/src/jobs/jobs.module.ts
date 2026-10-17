import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { InventoryModule } from "../inventory/inventory.module.js";
import { DomainEventHandlerRegistry } from "./domain-event-handlers.js";
import { JobsRepository } from "./jobs.repository.js";
import { JobsRunner } from "./jobs-runner.js";
import { SCHEDULER_CONFIG, type SchedulerConfig } from "./scheduler-config.js";
import { SCHEDULER_DATABASE_URL, SchedulerService } from "./scheduler.service.js";

export interface JobsModuleOptions {
  config: SchedulerConfig;
  /** The scheduler lock lives on its own connection (never the pool's), so it needs the URL. */
  databaseUrl: string;
}

/**
 * The scheduler (plan step 5c, ADR 0018): order expiry, the reservation sweep, domain event dispatch and the cart,
 * session and event cleanups, run by an in-process timer under a Postgres advisory lock and by `pnpm jobs:run-once`.
 * Core, no feature flag, no HTTP route. Needs the globals of `DatabaseModule`, `AuthModule` (clock) and `OrdersModule`.
 */
@Module({})
export class JobsModule {
  static register(options: JobsModuleOptions): DynamicModule {
    return {
      module: JobsModule,
      imports: [DiscoveryModule, InventoryModule],
      providers: [
        { provide: SCHEDULER_CONFIG, useValue: options.config },
        { provide: SCHEDULER_DATABASE_URL, useValue: options.databaseUrl },
        JobsRepository,
        DomainEventHandlerRegistry,
        JobsRunner,
        SchedulerService,
      ],
      exports: [SchedulerService, JobsRunner, DomainEventHandlerRegistry],
    };
  }
}
