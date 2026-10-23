import { useMemo } from "react";
import { useAdminConfig } from "./config-gate";
import type { UploadControls } from "./upload-panel";
import { useUploadQueue } from "./use-upload-queue";

/**
 * The logo upload of the brand form: a queue of one file whose success fills the `logoUrl` field. The normal save then
 * sends the address (`POST`/`PATCH /admin/brands`), which is what attaches the upload on the server. The limits and the
 * on/off switch come from `GET /admin/config`.
 */
export function useBrandLogoUpload(setLogoUrl: (url: string) => void): {
  uploadsEnabled: boolean;
  controls: UploadControls;
} {
  const media = useAdminConfig().media;
  const limits = useMemo(
    () => ({ maxBytes: media.maxBytes, contentTypes: media.contentTypes }),
    [media.maxBytes, media.contentTypes],
  );
  const queue = useUploadQueue({
    limits,
    maxRows: 1,
    maxFiles: 1,
    rowCount: () => 0,
    accept: (upload) => {
      setLogoUrl(upload.url);
      return true;
    },
  });
  return { uploadsEnabled: media.uploadsEnabled, controls: { ...queue, limits, maxFiles: 1 } };
}
