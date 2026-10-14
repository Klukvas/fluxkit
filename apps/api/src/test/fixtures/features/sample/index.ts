import { Controller, Get, Module } from "@nestjs/common";

// Test fixture only: lets core tests prove the feature loader mounts an enabled feature
// without depending on any real feature package (which may be deleted).
@Controller("sample")
class SampleController {
  @Get("ping")
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [SampleController] })
class SampleModule {}

export const featureModule = SampleModule;
