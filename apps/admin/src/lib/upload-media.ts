import type { AdminMediaUpload } from "@fluxkit/api-client";
import { adminClient } from "./api";
import { runWrite, type WriteOutcome } from "./run-write";

/**
 * The one place that sends an image to `POST /admin/media/uploads`: one request for one file, exactly once (`runWrite`).
 * Never repeated: an upload is not idempotent, and a lost answer may have stored the file (the upload queue says so). The
 * client sends the bytes as `application/octet-stream`; the server decides the real type by content.
 */
export function uploadOneFile(
  file: Blob,
  signal: AbortSignal,
): Promise<WriteOutcome<AdminMediaUpload>> {
  return runWrite(() => adminClient.uploadMedia(file, { signal }));
}
