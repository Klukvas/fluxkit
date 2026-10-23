import { Global, Module, type DynamicModule } from "@nestjs/common";
import { MEDIA_STORAGE_PORT } from "@fluxkit/core";
import {
  DisabledMediaStorage,
  LocalMediaStorage,
  type UploadStorage,
} from "./local-media-storage.js";
import { MediaAttachService } from "./media-attach.service.js";
import { MEDIA_CONFIG, type MediaConfig } from "./media-config.js";
import { MediaFilesController } from "./media-files.controller.js";
import { MediaUploadRepository } from "./media-upload.repository.js";
import { MediaUploadService } from "./media-upload.service.js";
import { MediaUploadsController } from "./media-uploads.controller.js";
import { ProcessingSlots } from "./processing-slots.js";

/**
 * Media upload and serving (ADR 0028; core, not a feature: switched by `MEDIA_STORAGE_DRIVER`). Global so the catalog
 * saves can mark uploads attached (`MediaAttachService`) and the admin config can read `MEDIA_CONFIG` without importing
 * this module. With the local driver the storage is checked at start (`LocalMediaStorage.open`), so a missing or
 * unwritable `MEDIA_DIR` stops the API instead of failing the first upload.
 */
@Global()
@Module({})
export class MediaModule {
  static register(config: MediaConfig): DynamicModule {
    return {
      module: MediaModule,
      controllers: [MediaUploadsController, MediaFilesController],
      providers: [
        { provide: MEDIA_CONFIG, useValue: config },
        {
          provide: MEDIA_STORAGE_PORT,
          useFactory: async (): Promise<UploadStorage> => {
            if (config.driver === "none") {
              return new DisabledMediaStorage();
            }
            if (config.directory === undefined || config.publicBaseUrl === undefined) {
              throw new Error("The local media driver needs MEDIA_DIR and MEDIA_PUBLIC_BASE_URL");
            }
            return LocalMediaStorage.open(config.directory);
          },
        },
        {
          provide: ProcessingSlots,
          useFactory: () =>
            new ProcessingSlots(config.tuning.processingSlots, config.tuning.slotWaitMs),
        },
        MediaUploadRepository,
        MediaUploadService,
        MediaAttachService,
      ],
      exports: [MEDIA_CONFIG, MEDIA_STORAGE_PORT, MediaAttachService],
    };
  }
}
