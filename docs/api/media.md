# API: media upload and media files

Image upload for product media and brand logos (ADR 0028, plan `docs/plans/2026-10-23-media-upload.md`, step 4). Core, not a feature: switched by `MEDIA_STORAGE_DRIVER` (`local` or `none`, `docs/contracts/config.md`). Code: `apps/api/src/media/`.

## Endpoints

| Endpoint | Auth | Purpose | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /admin/media/uploads` | admin, `catalog.write` (manager, owner) | Upload one image; it is checked by content, re-encoded without metadata and stored under a random key | Raw file bytes, `Content-Type: application/octet-stream` (the only admin route that accepts it), `X-Fluxkit-CSRF: 1`, `Content-Length` required. No file name, form field or JSON; the declared type and any name are ignored | 201 `{id, url, contentType, byteSize, width, height, createdAt}` describing the STORED file; `url` = `MEDIA_PUBLIC_BASE_URL` + `/` + key; no `Location`; `Cache-Control: no-store` | 400, 401, 403, 411, 413, 429, 503 (below) |
| `GET /media/{key}` | public (no cookie, no database read) | Serve an uploaded file | `key`: 32 lower-case hex digits and `.jpg`, `.png` or `.webp` | 200 the file, streamed, with the fixed headers below; 304 when `If-None-Match` matches the ETag | 404 (`no-store`, no echo of the key) for anything that is not a key, an absent file, or the `none` driver |
| `HEAD /media/{key}` | public | The headers of `GET`, no body | as `GET` | 200 | 404 |

Rate limit of the upload: `mediaUpload`, 60 per 10 minutes per signed-in admin user (not per address), in memory per process (`429` with `Retry-After`). At most 2 uploads are decoded at once per process; a third waits up to 10 s, then `429 too_many_requests` with `Retry-After: 5`.

## Upload errors

All are `application/problem+json`. Validation answers carry one `errors[]` entry `{path: "body", code}`.

| Status | `code` | `errors[].code` | When |
|---|---|---|---|
| 400 | `validation_failed` | `empty_file` | `Content-Length: 0` |
| 400 | `validation_failed` | `unsupported_type` | The first bytes are not JPEG, PNG or WebP (SVG, HTML, XML, PDF, TIFF, GIF, AVIF, HEIC and anything else; the image library never sees such a file), or libvips reports another format than the bytes |
| 400 | `validation_failed` | `corrupt_image` | Truncated or damaged data (decoded with `failOn: warning`) |
| 400 | `validation_failed` | `animated_not_supported` | More than one frame (animated WebP) |
| 400 | `validation_failed` | `dimensions_too_large` | More than 12 000 px on a side, read from the header before decoding |
| 400 | `validation_failed` | `too_many_pixels` | Width times height above `MEDIA_MAX_PIXELS`, read from the header |
| 400 | `validation_failed` | `processing_timeout` | Decoding and re-encoding took longer than 30 s |
| 400 | `validation_failed` | (none) | The body ended before `Content-Length` bytes arrived (the client went away) |
| 401 | `unauthorized` | | No session; answered before the body is read |
| 403 | `forbidden` | | Missing `X-Fluxkit-CSRF: 1`, a body that is not `application/octet-stream` (JSON, multipart, `text/plain`, form, `image/*` included), or a role without `catalog.write` (viewer); before the body is read |
| 411 | `validation_failed` | `length_required` | No `Content-Length`, or any `Transfer-Encoding` (chunked) |
| 413 | `validation_failed` | `file_too_large` | Declared length above `MEDIA_MAX_BYTES` (answered before the body is read, connection closed); the stream counter refuses a body that grows past the limit too |
| 429 | `too_many_requests` | | The rate limit, or both processing slots busy for 10 s (`Retry-After: 5`) |
| 503 | `storage_unavailable` | | The file could not be written: disk full, quota, read-only or missing directory (logged by error code) |
| 503 | `uploads_disabled` | | `MEDIA_STORAGE_DRIVER=none` (answered before the body is read) |

## What is stored

- The re-encoded output only, in the SAME format as the input: `.rotate()` applies the EXIF orientation, sRGB, shrunk to fit 4 096 px on the longer side and never enlarged; JPEG quality 85 progressive, PNG compression level 6, WebP quality 85; alpha kept for PNG and WebP. No metadata is written: EXIF (GPS, camera), XMP, IPTC, comments and ICC profiles are gone, and data appended after the image (polyglots) does not survive. sharp runs with `cache(false)` and `concurrency(1)`.
- Key: 128 random bits (`node:crypto` `randomBytes`) as 32 hex digits plus the output's extension. Path: `MEDIA_DIR/<2 hex>/<2 hex>/<key>`, directories 0750, files 0640. Temp files live in `MEDIA_DIR/.tmp` (`wx`, 0640) and are always removed; leftovers older than one hour are removed at start. The file is fsynced and moved in with `link` (never overwrites), then the `media_upload` row is inserted; when the insert fails, the file is removed again.
- Row `media_upload` (migration 0005): `storage_key`, `content_type`, `byte_size`, `width`, `height`, `sha256` (of the stored bytes), `created_by`, `created_at`, `first_attached_at`.
- One info log line per upload: `Stored upload id=... admin=... type=... bytesIn=... bytesOut=... width=... height=... durationMs=...`. Never bytes, a file name or a client header value.

## Served headers (`GET /media/{key}`, pinned by `media-files.spec.ts`)

`Content-Type` (`image/jpeg`, `image/png` or `image/webp`, from the key's extension), `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox`, `Content-Disposition: inline; filename="<key>"`, `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<key>"`, `Cross-Origin-Resource-Policy: cross-origin`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. A `404` carries `Cache-Control: no-store` and `nosniff`. Any path under `/media/` that is not exactly `/media/<key>` (percent-encoded keys, upper case, traversal, deeper paths) is `404`.

## Attach marking (product media and brand logos)

`PUT /admin/products/{id}/media`, `POST /admin/brands` and `PATCH /admin/brands/{id}` look, in the save's transaction, at every URL that starts with `MEDIA_PUBLIC_BASE_URL` + `/` (same origin after URL parsing, path prefix compared without case): it must be exactly `<prefix>/<key>` of an existing upload, else `400 validation_failed` with `upload_not_found` at `media.N.url` or `logoUrl` and nothing is saved. The uploads it names get `first_attached_at` (the first time only), under the row lock of the `UPDATE`, so the cleanup job's delete of never-attached rows (plan step 5) and an attaching save cannot both win. URLs on other prefixes are not looked at. An upload that was ever attached is never deleted automatically.

## Memory (measured for step 4)

Peak resident memory of one Node process running only the pipeline (`process.resourceUsage().maxRSS`, sharp 0.35.5, linux-x64; about 75 MB with sharp loaded): 50 MP JPEG 187 to 202 MB, near-limit PNG (49.99 MP) 151 to 157 MB, 49 MP WebP 302 MB, two 49 MP WebP at once (both processing slots) 523 MB. Each took 0.8 to 3.5 s. Plan for about 512 MB of headroom above the API's normal use. The re-encoded output is not size-capped: a 4 MB PNG of noisy blocks was stored as a 50 MB PNG. Full table: `docs/plans/2026-10-23-media-upload.md`, Step 4 outcome.

## Not built yet

The `/media` routes of the e2e and dev proxies and the deployment notes (plan step 8). The admin UI controls (step 7) exist: `apps/admin/README.md`, "Image upload"; the cleanup job (step 5) and the api-client method (step 6) too.
