import { Controller, Get, Module } from "@nestjs/common";

@Controller("example")
export class ExampleController {
  @Get("ping")
  ping(): { feature: string; ok: boolean } {
    return { feature: "example", ok: true };
  }
}

/**
 * Entry point read by the API feature loader (named export `featureModule`).
 * This module is only mounted when FEATURES_ENABLED contains "example".
 */
@Module({ controllers: [ExampleController] })
export class ExampleFeatureModule {}

export const featureModule = ExampleFeatureModule;
