import type { AdminMediaUpload } from "@fluxkit/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadOneFile } from "../../lib/upload-media";
import { useCrash } from "../../lib/use-crash";
import {
  createUploadController,
  type ControllerState,
  type UploadController,
} from "./upload-controller";
import {
  filesFromDrop,
  type DroppedData,
  type SelectedFile,
  type UploadLimits,
} from "./upload-queue";

export interface UseUploadQueueOptions {
  limits: UploadLimits;
  /** The most rows the list may have (a brand logo: 1). */
  maxRows: number;
  /** The most files of one selection (a brand logo: 1). */
  maxFiles: number;
  /** Rows in the list now, read when a selection is made. */
  rowCount: () => number;
  /** Puts one uploaded file into the list or the field; false when it no longer fits. */
  accept: (upload: AdminMediaUpload) => boolean;
}

export interface UploadQueue extends ControllerState {
  /** Files from the file input. */
  selectFiles: (files: readonly SelectedFile[]) => void;
  /** Files from a drop; folders and other items are ignored with a note. */
  dropFiles: (data: DroppedData) => void;
  cancelQueued: () => void;
  dismiss: () => void;
}

const IDLE: ControllerState = { items: [], running: false, notice: null };

/**
 * One upload queue for a screen (React around `createUploadController`). The latest options are read when a selection is
 * made and when an answer arrives. The queue ends with the screen. A bug goes to the route's error boundary.
 */
export function useUploadQueue(options: UseUploadQueueOptions): UploadQueue {
  const [state, setState] = useState<ControllerState>(IDLE);
  const latest = useRef(options);
  latest.current = options;
  const crash = useCrash();
  const [controller] = useState<UploadController>(() =>
    createUploadController({
      get limits() {
        return latest.current.limits;
      },
      get maxRows() {
        return latest.current.maxRows;
      },
      get maxFiles() {
        return latest.current.maxFiles;
      },
      rowCount: () => latest.current.rowCount(),
      accept: (upload) => latest.current.accept(upload),
      upload: uploadOneFile,
      onChange: setState,
    }),
  );
  useEffect(() => () => controller.dispose(), [controller]);

  const run = useCallback(
    (files: readonly SelectedFile[], ignored?: number) => {
      controller.start(files, ignored)?.catch(crash);
    },
    [controller, crash],
  );
  const selectFiles = useCallback((files: readonly SelectedFile[]) => run(files), [run]);
  const dropFiles = useCallback(
    (data: DroppedData) => {
      const dropped = filesFromDrop(data);
      run(dropped.files, dropped.ignored);
    },
    [run],
  );
  return {
    ...state,
    selectFiles,
    dropFiles,
    cancelQueued: controller.cancelQueued,
    dismiss: controller.dismiss,
  };
}
