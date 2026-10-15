import { Module } from "@nestjs/common";
import { OptionsController } from "./options.controller.js";
import { OptionsRepository } from "./options.repository.js";
import { OptionsService } from "./options.service.js";

@Module({
  controllers: [OptionsController],
  providers: [OptionsService, OptionsRepository],
})
export class OptionsModule {}
