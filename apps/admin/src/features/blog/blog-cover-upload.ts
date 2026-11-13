import type { AdminMediaUpload } from "@fluxkit/api-client";
import { useMemo } from "react";
import { useAdminConfig } from "../../areas/catalog-dictionaries/config-gate";
import type { UploadControls } from "../../areas/catalog-dictionaries/upload-panel";
import { useUploadQueue } from "../../areas/catalog-dictionaries/use-upload-queue";

export interface BlogCoverUpload {
  /** `GET /admin/config` `media.uploadsEnabled`. */
  uploadsEnabled: boolean;
  /** A file is uploading: the save waits for it. */
  running: boolean;
  controls: UploadControls;
}

/**
 * The cover upload of the post form (the brand logo pattern): a queue of one file whose success becomes the form's cover.
 * The save then sends its id (`coverUploadId`), which attaches the upload on the server in the save's transaction.
 */
export function useBlogCoverUpload(
  onUploaded: (upload: AdminMediaUpload) => void,
): BlogCoverUpload {
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
      onUploaded(upload);
      return true;
    },
  });
  return {
    uploadsEnabled: media.uploadsEnabled,
    running: queue.running,
    controls: { ...queue, limits, maxFiles: 1 },
  };
}
