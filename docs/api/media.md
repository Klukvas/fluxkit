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
| 400 | `validation_failed` | `output_too_large` | The re-encoded output is larger than `MEDIA_MAX_BYTES` (a two-colour PNG becomes 24-bit RGB and can grow several times); nothing is stored. Added by the step 9 review (M-1), additive |
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

**Only the exact configured prefix counts** (step 9 review L-3, no code change): the scheme, the host spelling and the port must be those of `MEDIA_PUBLIC_BASE_URL` (host case and a default port are normalized, nothing else). A URL of the same file written with another scheme (`http` for `https`), another host name (`www.shop.example` for `shop.example`, `localhost` for `127.0.0.1`) or through an alias or CDN host is FOREIGN: the save accepts it (`200`) without marking the upload, so the upload stays unattached and job 7 deletes its file 24 hours after the upload, while the product or brand (and an order snapshot taken meanwhile) keeps pointing at it. The admin UI always puts the URL the upload answered into the list or the logo field; the risk is a URL pasted or edited by hand, or an API client that rewrites URLs.

## The driver `none` (step 9 review M-2)

`MEDIA_STORAGE_DRIVER=none` switches uploads off (`503 uploads_disabled`), and, as ADR 0028 decision 2 says, also the read route: **every URL of an uploaded file answers `404` while it is set**, product images, brand logos and the `order_item.image_url` snapshots included. The cleanup job does nothing under `none`. Switching back to `local` serves the files again, and the job then deletes every never-attached upload older than 24 hours. Attach marking works under `none` too: `loadEnv` resolves `MEDIA_PUBLIC_BASE_URL` with either driver (the development default `http://127.0.0.1:<PORT>/media` when unset outside production, the given value when set; in production with `none` and no value it stays unset, and then no URL is ours), so a product or brand save made while uploads are off still marks (or refuses with `upload_not_found`) the uploads it names, and a later `local` run does not delete them. Keep `local` while uploads exist and never use `none` as a temporary switch (a full disk answers `503 storage_unavailable` with `local` and keeps serving).

## Memory (measured for step 4)

Peak resident memory of one Node process running only the pipeline (`process.resourceUsage().maxRSS`, sharp 0.35.5, linux-x64; about 75 MB with sharp loaded): 50 MP JPEG 187 to 202 MB, near-limit PNG (49.99 MP) 151 to 157 MB, 49 MP WebP 302 MB, two 49 MP WebP at once (both processing slots) 523 MB. Each took 0.8 to 3.5 s. Plan for about 512 MB of headroom above the API's normal use. Full table: `docs/plans/2026-10-23-media-upload.md`, Step 4 outcome.

- **Output cap (step 9 review M-1).** The re-encoded output may not be larger than `MEDIA_MAX_BYTES` (inclusive); above it the upload is `400 output_too_large` and nothing is written. Without the cap a 6.1 MB two-colour noise PNG of 7 000 x 7 000 was stored as a 40 MB PNG (the re-encode is 24-bit RGB). PNG output is not quantised to a palette (that would be lossy for photos; ADR 0028 keeps PNG lossless).
- **The output is one in-memory buffer** per processing slot until the cap check (sharp `toBuffer`; libvips has no streaming encoder behind sharp's output stream). The largest possible one is a 4 096 x 4 096 RGBA PNG that does not compress, about 67 MB. The cap bounds the disk, not this peak. Measured after the fix (fresh process, sharp 0.35.5, linux-x64): the 6.1 MB 1-bit PNG (output 40 MB, refused at the default cap) peaks at 134 MB RSS, a 5.1 MB 1-bit PNG with transparency (output 34 MB) at 150 MB, both at once at 214 MB: inside the measured worst case above (two 49 MP WebP, 523 MB), so the 512 MB headroom stays the figure to plan with.
- **Disk-fill worst case with the cap and the rate limit:** one signed-in `catalog.write` user can store at most 60 uploads per 10 minutes of at most `MEDIA_MAX_BYTES` each: 8 640 x 10 MiB, about 84 GiB per user per day at the default (about 422 GiB at the 50 MiB maximum of `MEDIA_MAX_BYTES`). Unattached uploads are deleted by job 7 once older than 24 hours, so without attaching anything the standing worst case is about one day of that per user (plus the time until the next tick); attached uploads stay. The rate limit counts per process, so several API processes multiply it; several managers add up. A per-user byte quota does not exist (later plan). While up to 2 slots process, `MEDIA_DIR/.tmp` also holds each upload's input (at most `MEDIA_MAX_BYTES`) and its output temp file (at most `MEDIA_MAX_BYTES`).

## Routing and operations (plan step 8)

`/media/*` is routed to the API by the e2e proxies (`apps/admin/e2e/proxy.ts`, `apps/storefront/e2e/proxy.ts`), by the Vite dev and preview proxy (`apps/admin/vite.config.ts`, target `ADMIN_DEV_API_URL`) and in the README Caddy and nginx examples (untested). The browser e2e of uploads is `apps/admin/e2e/tests/media-upload.e2e.ts`. The volume, backup, memory, nginx body size, Next optimizer and cleanup-job notes are in the root `README.md`, "Uploaded images". The bare `/media` and `/media/` answer the router's `404` without `Cache-Control: no-store` and `X-Content-Type-Options` (every path with a segment has both; `apps/admin/e2e/README.md`, "Findings of media plan step 8").
