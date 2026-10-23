import { Controller, Get, Head, Inject, Logger, Req, Res } from "@nestjs/common";
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import {
  contentTypeOf,
  isMediaKey,
  MEDIA_STORAGE_PORT,
  typeOfKey,
  type MediaKey,
  type MediaStoragePort,
} from "@fluxkit/core";
import { notFound } from "../common/problem.js";

/** The fixed headers of a served file (ADR 0028 decision 6); `media-files.spec.ts` pins every one. */
export const MEDIA_FILE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "Cache-Control": "public, max-age=31536000, immutable",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
});

/** `/media/<key>` exactly; the key is the RAW path segment (still percent-encoded), so an encoded key never matches. */
const MEDIA_PATH = /^\/media\/([^/]+)$/i;

function keyOf(request: Request): MediaKey | undefined {
  const match = MEDIA_PATH.exec(request.path);
  const raw = match?.[1];
  return isMediaKey(raw) ? raw : undefined;
}

/**
 * `GET` and `HEAD /media/{key}`: the public read route of uploaded files (ADR 0028 decision 6). Outside `/admin` and
 * `/store`; it reads no cookie and no database row: the key is checked by its pattern and the content type follows from
 * its extension, which the server chose from the sniffed type. A key that is not a key, or names no file, is `404` with
 * `no-store` and no echo of the key. The file is streamed, never buffered.
 */
@Controller("media")
@ApiTags("media")
export class MediaFilesController {
  private readonly logger = new Logger("MediaFiles");

  constructor(@Inject(MEDIA_STORAGE_PORT) private readonly storage: MediaStoragePort) {}

  @Get(":key")
  @ApiOperation({ summary: "An uploaded image (public, cached for a year, never changes)" })
  @ApiParam({ name: "key", description: "32 lower-case hex digits and .jpg, .png or .webp." })
  @ApiProduces("image/jpeg", "image/png", "image/webp")
  @ApiResponse({ status: 200, description: "The file, with fixed security and caching headers." })
  @ApiResponse({ status: 304, description: "If-None-Match matched the ETag (the key)." })
  @ApiResponse({ status: 404, description: "Not a key, no such file, or uploads switched off." })
  get(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.serve(request, response, true);
  }

  @Head(":key")
  @ApiOperation({ summary: "The headers of an uploaded image, without the body" })
  @ApiParam({ name: "key", description: "32 lower-case hex digits and .jpg, .png or .webp." })
  @ApiResponse({ status: 200, description: "The headers of GET, no body." })
  @ApiResponse({ status: 404, description: "Not a key, no such file, or uploads switched off." })
  head(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.serve(request, response, false);
  }

  /**
   * The bare `/media` and `/media/` (no key): the same 404 instead of the router's cacheable one (step 9 review). Express
   * answers HEAD with this GET handler (no body), so no separate HEAD route is needed here.
   */
  @Get()
  @ApiExcludeEndpoint()
  getBare(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.serve(request, response, true);
  }

  /** Deeper paths (`/media/ab/cd/<key>`) are never files: the same 404 instead of the router's cacheable one. */
  @Get("*rest")
  @ApiExcludeEndpoint()
  getOther(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.serve(request, response, true);
  }

  @Head("*rest")
  @ApiExcludeEndpoint()
  headOther(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.serve(request, response, false);
  }

  private async serve(request: Request, response: Response, withBody: boolean): Promise<void> {
    const key = keyOf(request);
    const opened = key === undefined ? undefined : await this.storage.open(key);
    if (key === undefined || opened === undefined) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      throw notFound("The media file");
    }
    for (const [name, value] of Object.entries(MEDIA_FILE_HEADERS)) {
      response.setHeader(name, value);
    }
    const etag = `"${key}"`;
    response.setHeader("ETag", etag);
    if (request.headers["if-none-match"]?.split(",").some((tag) => tag.trim() === etag) === true) {
      opened.stream.destroy();
      response.status(304).end();
      return;
    }
    response.setHeader("Content-Type", contentTypeOf(typeOfKey(key)));
    response.setHeader("Content-Length", String(opened.byteSize));
    response.setHeader("Content-Disposition", `inline; filename="${key}"`);
    response.status(200);
    if (!withBody) {
      opened.stream.destroy();
      response.end();
      return;
    }
    try {
      await pipeline(opened.stream, response);
    } catch (error) {
      // The headers are sent, so the only answer left is to stop. A client that went away is normal; anything else (a
      // read error of the disk) is logged by its code.
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "ERR_STREAM_PREMATURE_CLOSE") {
        this.logger.error(`Serving a media file failed code=${String(code ?? "unknown")}`);
      }
      opened.stream.destroy();
      response.destroy();
    }
  }
}
