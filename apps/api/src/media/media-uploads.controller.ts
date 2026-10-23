import { HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, getSchemaPath } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AdminController } from "../auth/admin-controller.decorator.js";
import type { AdminPrincipal } from "../auth/admin-authenticator.js";
import { AcceptsBinaryUpload } from "../auth/csrf.js";
import { CurrentAdmin } from "../auth/current-admin.js";
import { ApiProblemResponses, ApiZodResponse, ProblemDetailsDoc } from "../common/openapi.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { mediaUploadResponseSchema, type MediaUploadResponse } from "./media.schemas.js";
import { MediaUploadService } from "./media-upload.service.js";

const PROBLEM = {
  "application/problem+json": { schema: { $ref: getSchemaPath(ProblemDetailsDoc) } },
};

/**
 * `POST /admin/media/uploads` (ADR 0028 decision 3). Permission `catalog.write` through the catalog default pair of
 * `@AdminController`. The only route marked `@AcceptsBinaryUpload()`: its body is the raw file as
 * `application/octet-stream`, never parsed by Express (no body parser handles that type), and streamed by the service.
 */
@AdminController("media")
export class MediaUploadsController {
  constructor(@Inject(MediaUploadService) private readonly uploads: MediaUploadService) {}

  @Post("uploads")
  @HttpCode(201)
  @AcceptsBinaryUpload()
  @RateLimit("mediaUpload")
  @ApiOperation({
    summary:
      "Upload one image (JPEG, PNG or WebP): checked by content, re-encoded without metadata, stored",
  })
  @ApiConsumes("application/octet-stream")
  @ApiBody({
    required: true,
    description:
      "The raw file bytes, one file per request. Content-Length is required; the declared type and any name are ignored.",
    schema: { type: "string", format: "binary" },
  })
  @ApiZodResponse(
    201,
    mediaUploadResponseSchema,
    "The stored image (the re-encoded output). Put `url` into a product media list or a brand logo.",
  )
  @ApiProblemResponses(400, 429)
  @ApiResponse({
    status: 411,
    description:
      "validation_failed with reason length_required: no Content-Length, or chunked transfer.",
    content: PROBLEM,
  })
  @ApiResponse({
    status: 413,
    description:
      "validation_failed with reason file_too_large: larger than MEDIA_MAX_BYTES (checked before the body is read).",
    content: PROBLEM,
  })
  @ApiResponse({
    status: 503,
    description:
      "storage_unavailable (the file could not be written: disk full, quota, read-only or missing directory) or uploads_disabled (MEDIA_STORAGE_DRIVER=none).",
    content: PROBLEM,
  })
  upload(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<MediaUploadResponse> {
    return this.uploads.upload(request, admin, {
      closeConnection: () => response.setHeader("Connection", "close"),
    });
  }
}
