import { Module } from "@nestjs/common";
import { AdminConfigController } from "./admin-config.controller.js";

/** The admin config route (plan `docs/plans/2026-10-19-admin-ui.md`, step 2). The configuration providers are global. */
@Module({ controllers: [AdminConfigController] })
export class AdminConfigModule {}
