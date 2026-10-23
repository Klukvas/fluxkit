import { Button, LiveRegion, cn, type Translator } from "@fluxkit/ui";
import type { DragEvent, ReactNode } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { describe } from "./form-parts";
import type { UploadQueue } from "./use-upload-queue";
import {
  acceptAttribute,
  stateMessage,
  summarizeUploads,
  summaryMessages,
  type UploadLimits,
  type UploadState,
} from "./upload-queue";

/** An upload queue with the limits it checks against: what the panel and the drop zone need. */
export interface UploadControls extends UploadQueue {
  limits: UploadLimits;
  /** The most files of one selection (1 for a brand logo). */
  maxFiles: number;
}

function Message({ t, descriptor }: { t: Translator; descriptor: MessageDescriptor }) {
  return (
    <>
      {describe(t, descriptor)}
      {descriptor.code === undefined ? null : (
        <small className="ms-2 text-muted-foreground">
          {t("errors.reference", { code: descriptor.code })}
        </small>
      )}
    </>
  );
}

const TONE: Record<UploadState["status"], string> = {
  queued: "text-muted-foreground",
  uploading: "text-foreground",
  added: "text-foreground",
  failed: "text-danger",
  unknown: "text-danger",
  rejected: "text-danger",
  cancelled: "text-muted-foreground",
};

/**
 * The upload button, the cancel button, the per-file status list and the live-region summary of one screen's queue. The
 * button is a `<label>` around a visually hidden file input: the keyboard reaches the input itself (Enter or Space opens
 * the file dialog), and the label text is its name. The input's `accept` comes from the server's `media.contentTypes`.
 * The input is cleared after each selection, so the same file can be chosen again. Nothing here uploads by itself.
 */
export function UploadPanel({
  t,
  id,
  label,
  multiple,
  controls,
}: {
  t: Translator;
  id: string;
  label: string;
  multiple: boolean;
  controls: UploadControls;
}) {
  const { items, running, notice, limits, maxFiles } = controls;
  const summary = summaryMessages(summarizeUploads(items));
  const waiting = items.some((item) => item.state.status === "queued");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={id}
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 font-medium text-foreground",
            "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
            running ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          )}
        >
          <span>{label}</span>
          <input
            id={id}
            type="file"
            className="sr-only"
            multiple={multiple}
            accept={acceptAttribute(limits.contentTypes)}
            disabled={running}
            onChange={(event) => {
              const input = event.currentTarget;
              // Copy the list first: clearing the input empties it. Cleared so the same file can be chosen again.
              const files = Array.from(input.files ?? []);
              input.value = "";
              controls.selectFiles(files);
            }}
          />
        </label>
        {running && waiting ? (
          <Button variant="secondary" onClick={controls.cancelQueued}>
            {t("dict.upload.cancel")}
          </Button>
        ) : null}
        {!running && items.length > 0 ? (
          <Button variant="secondary" onClick={controls.dismiss}>
            {t("dict.upload.dismiss")}
          </Button>
        ) : null}
      </div>
      <LiveRegion>
        {[...(notice === null ? [] : [notice]), ...summary].map((descriptor, index) => (
          <p key={`${descriptor.key}-${index}`}>
            <Message t={t} descriptor={descriptor} />
          </p>
        ))}
      </LiveRegion>
      {items.length === 0 ? null : (
        <ul aria-label={t("dict.upload.listLabel")} className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap gap-x-2">
              <span className="break-all font-medium">{item.name}</span>
              <span className={TONE[item.state.status]}>
                <Message t={t} descriptor={stateMessage(item.state, limits, maxFiles)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether a drag or drop target is a text field (a text dragged into it keeps its default behaviour). */
function overTextField(target: EventTarget): boolean {
  return target instanceof Element && target.closest("input, textarea, select") !== null;
}

/**
 * A pointer-only enhancement around the list: files dropped on it go to the same handler as the file input (the keyboard
 * path is the button). Anything dropped that is not a file, and folders, are ignored with a note.
 */
export function DropZone({
  onDrop,
  children,
}: {
  /** Without a handler (no write permission, uploads off, list full) the zone is just its content. */
  onDrop: UploadControls["dropFiles"] | undefined;
  children: ReactNode;
}) {
  if (onDrop === undefined) return <>{children}</>;
  return (
    <div
      className="flex flex-col gap-6 rounded-md border border-dashed border-border p-2"
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        if (!overTextField(event.target)) event.preventDefault();
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        if (overTextField(event.target)) return;
        event.preventDefault();
        onDrop(event.dataTransfer);
      }}
    >
      {children}
    </div>
  );
}
