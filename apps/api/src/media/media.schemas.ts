import { ALLOWED_IMAGE_TYPES } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../common/openapi-formats.js";

const contentTypes = Object.values(ALLOWED_IMAGE_TYPES).map(({ contentType }) => contentType);

/** `201` of `POST /admin/media/uploads`: what was STORED (the re-encoded output), not what was sent. */
export const mediaUploadResponseSchema = z.object({
  id: uuidSchema,
  url: z.string().meta({
    description:
      "`MEDIA_PUBLIC_BASE_URL` + `/` + the storage key; put it into a media list or a brand logo.",
  }),
  contentType: z.enum(contentTypes as [string, ...string[]]),
  byteSize: z.number().int().min(1).meta({ description: "Bytes of the stored file." }),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  createdAt: timestampSchema,
});

export type MediaUploadResponse = z.output<typeof mediaUploadResponseSchema>;
