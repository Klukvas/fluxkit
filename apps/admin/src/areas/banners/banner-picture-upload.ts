import type { AdminMediaUpload } from "@fluxkit/api-client";
import { useMemo, useRef, useState } from "react";
import { useAdminConfig } from "../catalog-dictionaries/config-gate";
import type { UploadControls } from "../catalog-dictionaries/upload-panel";
import { useUploadQueue } from "../catalog-dictionaries/use-upload-queue";

/** A picture slot of the form: the default picture (`null`) or a content locale's own picture. */
export type PictureSlot = string | null;

export interface BannerPictureUpload {
  /** `GET /admin/config` `media.uploadsEnabled`. */
  uploadsEnabled: boolean;
  /** A file is uploading (in any slot): the save waits, every slot's input is locked. */
  running: boolean;
  /** The controls of one slot: the shared queue, showing its files and notice only in the slot that started it. */
  controlsFor: (slot: PictureSlot) => UploadControls;
}

/**
 * The picture uploads of the banner form (the `useBrandLogoUpload` pattern): ONE queue of one file for every slot, so one
 * upload runs at a time. A selection names its slot; the uploaded picture goes into that slot (`onUploaded`), and the
 * normal save sends its id, which attaches the upload on the server (`markAttachedByIds`). A selection made while a file
 * uploads is ignored by the queue, and the slot is not switched then.
 */
export function useBannerPictureUpload(
  onUploaded: (slot: PictureSlot, upload: AdminMediaUpload) => void,
): BannerPictureUpload {
  const media = useAdminConfig().media;
  const limits = useMemo(
    () => ({ maxBytes: media.maxBytes, contentTypes: media.contentTypes }),
    [media.maxBytes, media.contentTypes],
  );
  const target = useRef<PictureSlot>(null);
  const [shownIn, setShownIn] = useState<PictureSlot | undefined>(undefined);
  const queue = useUploadQueue({
    limits,
    maxRows: 1,
    maxFiles: 1,
    rowCount: () => 0,
    accept: (upload) => {
      onUploaded(target.current, upload);
      return true;
    },
  });
  function controlsFor(slot: PictureSlot): UploadControls {
    const own = shownIn === slot;
    return {
      ...queue,
      items: own ? queue.items : [],
      notice: own ? queue.notice : null,
      limits,
      maxFiles: 1,
      selectFiles: (files) => {
        if (!queue.running) {
          target.current = slot;
          setShownIn(slot);
        }
        queue.selectFiles(files);
      },
      dropFiles: (data) => {
        if (!queue.running) {
          target.current = slot;
          setShownIn(slot);
        }
        queue.dropFiles(data);
      },
    };
  }
  return { uploadsEnabled: media.uploadsEnabled, running: queue.running, controlsFor };
}
