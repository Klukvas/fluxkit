import { Module } from "@nestjs/common";
import { AttributesController } from "./attributes.controller.js";
import { AttributesRepository } from "./attributes.repository.js";
import { AttributesService } from "./attributes.service.js";

@Module({
  controllers: [AttributesController],
  providers: [AttributesService, AttributesRepository],
})
export class AttributesModule {}
