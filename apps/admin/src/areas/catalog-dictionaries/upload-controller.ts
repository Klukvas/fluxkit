import type { AdminMediaUpload } from "@fluxkit/api-client";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import {
  dropNotice,
  planUploads,
  runUploadQueue,
  type SelectedFile,
  type UploadItem,
  type UploadLimits,
} from "./upload-queue";

export interface ControllerState {
  /** The files of the last selection, with their states (a new selection replaces the list). */
  items: readonly UploadItem[];
  /** The queue runs: the screen disables its buttons, including save. */
  running: boolean;
  /** A note about a drop that skipped items or gave no file. */
  notice: MessageDescriptor | null;
}

export interface ControllerDeps {
  limits: UploadLimits;
  maxRows: number;
  maxFiles: number;
  /** Rows in the list when the selection is made. */
  rowCount: () => number;
  /** Puts one uploaded file into the list or field; false when it no longer fits. */
  accept: (upload: AdminMediaUpload) => boolean;
  upload: (file: Blob, signal: AbortSignal) => Promise<WriteOutcome<AdminMediaUpload>>;
  /** Called with every new state (a React `setState`). */
  onChange: (state: ControllerState) => void;
}

export interface UploadController {
  state: () => ControllerState;
  /** True from the moment a queue starts (before React renders `running`) until it settled. */
  pending: () => boolean;
  /**
   * Checks the files and uploads the accepted ones one at a time. While a queue runs this does nothing and returns
   * `null` (a double click, a second drop). `ignored` is the number of dropped items that were not files; pass it for a
   * drop only. The promise ends when the queue is done; a bug rejects it.
   */
  start: (files: readonly SelectedFile[], ignored?: number) => Promise<void> | null;
  /** Cancels the files that still wait; the request in flight finishes. */
  cancelQueued: () => void;
  /** Clears the finished list (not while the queue runs). */
  dismiss: () => void;
  /** The screen goes away: ends everything, the request in flight included. */
  dispose: () => void;
}

const IDLE: ControllerState = { items: [], running: false, notice: null };

/**
 * The state machine of one screen's upload queue, without React (tested on its own): exactly one queue at a time through
 * a single flight, so two clicks in one task send one queue. Nothing here retries or repeats a request.
 */
export function createUploadController(deps: ControllerDeps): UploadController {
  const flight = createSingleFlight();
  let state: ControllerState = IDLE;
  let nextId = 1;
  let cancelled = false;
  let abort: AbortController | null = null;

  function emit(next: ControllerState) {
    state = next;
    deps.onChange(next);
  }

  return {
    state: () => state,
    pending: flight.pending,
    start(files, ignored) {
      if (flight.pending()) return null;
      const notice = ignored === undefined ? null : dropNotice(files.length, ignored);
      if (files.length === 0) {
        if (notice !== null) emit({ ...state, notice });
        return Promise.resolve();
      }
      const plan = planUploads(files, {
        rowCount: deps.rowCount(),
        maxRows: deps.maxRows,
        maxFiles: deps.maxFiles,
        limits: deps.limits,
        firstId: nextId,
      });
      nextId += files.length;
      if (plan.queue.length === 0) {
        emit({ items: plan.items, running: false, notice });
        return Promise.resolve();
      }
      cancelled = false;
      const controller = new AbortController();
      abort = controller;
      emit({ items: plan.items, running: true, notice });
      return flight.run(async () => {
        try {
          await runUploadQueue({
            queue: plan.queue,
            upload: deps.upload,
            signal: controller.signal,
            isCancelled: () => cancelled,
            onState: (id, itemState) =>
              emit({
                ...state,
                items: state.items.map((item) =>
                  item.id === id ? { ...item, state: itemState } : item,
                ),
              }),
            accept: deps.accept,
          });
        } finally {
          abort = null;
          emit({ ...state, running: false });
        }
      });
    },
    cancelQueued() {
      cancelled = true;
      emit({
        ...state,
        items: state.items.map((item) =>
          item.state.status === "queued" ? { ...item, state: { status: "cancelled" } } : item,
        ),
      });
    },
    dismiss() {
      if (flight.pending()) return;
      emit({ ...state, items: [], notice: null });
    },
    dispose() {
      abort?.abort();
    },
  };
}
