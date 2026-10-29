import { Module, type DynamicModule } from "@nestjs/common";
import { PrivacyAdminController } from "./admin/privacy-admin.controller.js";
import { PrivacyAdminService } from "./admin/privacy-admin.service.js";
import { PrivacyErasureService } from "./erasure/privacy-erasure.service.js";
import { PersonalDataExportService } from "./export/personal-data-export.service.js";
import { PersonalDataReader } from "./export/personal-data.reader.js";
import { PRIVACY_CONFIG, type PrivacyConfig } from "./privacy-config.js";

/**
 * Privacy (ADR 0033): the personal-data reader and export, privacy requests and the admin Privacy routes. Core, no
 * feature flag. Needs the globals of `AuthModule` (clock, guard), `RateLimitModule`, `AdminAuditModule`, `CommonModule`
 * (locales), the provider registries and the database. `CustomersModule` imports it for the store export route.
 */
@Module({})
export class PrivacyModule {
  static register(config: PrivacyConfig): DynamicModule {
    return {
      module: PrivacyModule,
      global: true,
      controllers: [PrivacyAdminController],
      providers: [
        { provide: PRIVACY_CONFIG, useValue: config },
        PersonalDataReader,
        PersonalDataExportService,
        PrivacyAdminService,
        PrivacyErasureService,
      ],
      exports: [
        PRIVACY_CONFIG,
        PersonalDataReader,
        PersonalDataExportService,
        PrivacyAdminService,
        PrivacyErasureService,
      ],
    };
  }
}
