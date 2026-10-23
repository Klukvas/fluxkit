import type { AdminMediaUpload, ProblemDetails } from "@fluxkit/api-client";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import { retryAfterMinutes } from "../../lib/retry-after";
import type { WriteOutcome } from "../../lib/run-write";

/**
 * The upload queue of the Media tab and the brand logo (plan `docs/plans/2026-10-23-media-upload.md`, section 6; ADR 0028).
 * Pure rules and one async runner; no React, no network of its own. The screen picks files, `planUploads` refuses what the
 * server would refuse (the same limits, read from `GET /admin/config`) BEFORE any request, and `runUploadQueue` sends the
 * rest ONE AT A TIME. Nothing is retried or replayed: an upload is not idempotent, a lost answer is `unknown` (the file may
 * have been stored; the server deletes an unattached upload after 24 hours), and a failure never stops the other files
 * (except a 401 or 403, which ends the session for all of them).
 */

/** At most this many files of one selection (the 21st and later are refused). */
export const MAX_FILES_PER_SELECTION = 20;

/** What the server's `media` block of `GET /admin/config` says (`maxBytes`, `contentTypes`). */
export interface UploadLimits {
  maxBytes: number;
  contentTypes: readonly string[];
}

/** The `accept` attribute of the file input: the server's types, never a list of our own. */
export function acceptAttribute(contentTypes: readonly string[]): string {
  return contentTypes.join(",");
}

/** Why a file is refused before any request; each has a message `dict.upload.reject.<reason>`. */
export const REJECT_REASONS = [
  "emptyFile",
  "unsupportedType",
  "fileTooLarge",
  "tooManyFiles",
  "noRoom",
  "duplicate",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** The states with a plain message `dict.upload.state.<status>` (the others carry their own text). */
export const PLAIN_STATE_STATUSES = ["queued", "uploading", "added", "cancelled"] as const;

export type UploadState =
  | { status: "queued" }
  | { status: "uploading" }
  | { status: "added"; url: string }
  | { status: "failed"; message: MessageDescriptor }
  | { status: "unknown" }
  | { status: "rejected"; reason: RejectReason }
  | { status: "cancelled" };

export interface UploadItem {
  id: number;
  /** The file's name as the browser gave it: shown as text, never sent, never used as a key. */
  name: string;
  state: UploadState;
}

export interface QueuedFile {
  id: number;
  file: Blob;
}

export interface PlanContext {
  /** Rows in the list now (a brand logo: 0). */
  rowCount: number;
  /** The most rows the list may have (`MAX_MEDIA`; a brand logo: 1). */
  maxRows: number;
  /** The most files of one selection (`MAX_FILES_PER_SELECTION`; a brand logo: 1). */
  maxFiles: number;
  limits: UploadLimits;
  /** The id of the first file of this selection (ids never repeat within a screen). */
  firstId: number;
}

export interface UploadPlan {
  /** Every selected file, in order, with its first state (`queued` or `rejected`). */
  items: UploadItem[];
  /** The files to upload, in the same order. */
  queue: QueuedFile[];
}

/** A selected file: a browser `File` (a `Blob` with a name). */
export type SelectedFile = Blob & { readonly name: string; readonly lastModified?: number };

/**
 * The client-side mirror of the server's gate, in this order for each file: place in the selection (at most 20), empty
 * file, type (`file.type` against the server's `contentTypes`; the server decides by content again), size, a repeat of a
 * file already taken in this selection, room in the list (rows plus files at most `maxRows`). The server checks
 * everything again and decides; these checks only save requests that cannot succeed.
 */
export function planUploads(files: readonly SelectedFile[], context: PlanContext): UploadPlan {
  const types = new Set(context.limits.contentTypes.map((type) => type.toLowerCase()));
  const room = Math.max(0, context.maxRows - context.rowCount);
  const seen = new Set<string>();
  const items: UploadItem[] = [];
  const queue: QueuedFile[] = [];
  files.forEach((file, index) => {
    const id = context.firstId + index;
    const reject = (reason: RejectReason) =>
      items.push({ id, name: file.name, state: { status: "rejected", reason } });
    if (index >= context.maxFiles) return reject("tooManyFiles");
    if (file.size === 0) return reject("emptyFile");
    if (!types.has(file.type.toLowerCase())) return reject("unsupportedType");
    if (file.size > context.limits.maxBytes) return reject("fileTooLarge");
    const identity = `${file.name}\u0000${file.size}\u0000${file.lastModified ?? ""}`;
    if (seen.has(identity)) return reject("duplicate");
    if (queue.length >= room) return reject("noRoom");
    seen.add(identity);
    items.push({ id, name: file.name, state: { status: "queued" } });
    queue.push({ id, file });
  });
  return { items, queue };
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** The size limit in megabytes with one decimal, at least 0.1 (the limit is 1 KiB to 50 MiB). */
function maxMegabytes(limits: UploadLimits): number {
  return Math.max(0.1, Math.round((limits.maxBytes / BYTES_PER_MEGABYTE) * 10) / 10);
}

/** The allowed types without the `image/` prefix: `jpeg, png, webp`. */
function typeNames(limits: UploadLimits): string {
  return limits.contentTypes.map((type) => type.replace(/^image\//, "")).join(", ");
}

/** The message of a refusal made before any request. */
export function rejectionMessage(
  reason: RejectReason,
  limits: UploadLimits,
  maxFiles: number = MAX_FILES_PER_SELECTION,
): MessageDescriptor {
  const key = `dict.upload.reject.${reason}`;
  switch (reason) {
    case "fileTooLarge":
      return { key, values: { max: maxMegabytes(limits) } };
    case "unsupportedType":
      return { key, values: { types: typeNames(limits) } };
    case "tooManyFiles":
      return { key, values: { max: maxFiles } };
    default:
      return { key };
  }
}

/** The numbers a hint about the limits names: the types (`jpeg, png, webp`), the largest file in MB and the files per selection. */
export function limitValues(
  limits: UploadLimits,
  maxFiles: number,
): { types: string; max: number; files: number } {
  return { types: typeNames(limits), max: maxMegabytes(limits), files: maxFiles };
}

/** What to show for a file's state (the screen adds the file name). */
export function stateMessage(
  state: UploadState,
  limits: UploadLimits,
  maxFiles: number = MAX_FILES_PER_SELECTION,
): MessageDescriptor {
  switch (state.status) {
    case "rejected":
      return rejectionMessage(state.reason, limits, maxFiles);
    case "failed":
      return state.message;
    case "unknown":
      return { key: "dict.upload.unknown" };
    default:
      return { key: `dict.upload.state.${state.status}` };
  }
}

/**
 * Why the upload route refused, as a message. The API's English `detail` is never shown. The route's own reasons (`errors[]`)
 * come first; a 413 or 411 without one still has its own message (NOT the 100 KB JSON text of `describeProblem`); a 429
 * names the wait from `Retry-After`; the rest (401, 403, 503 `storage_unavailable` and `uploads_disabled`) go through
 * the problem map.
 */
export function describeUploadProblem(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): MessageDescriptor {
  if (status === 429) {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null
      ? describeProblem(status, problem)
      : { key: "dict.upload.rateLimited", values: { minutes } };
  }
  const reason = problem.errors?.[0]?.code;
  if (reason !== undefined) return describeFieldError(reason);
  if (status === 413) return describeFieldError("file_too_large");
  if (status === 411) return describeFieldError("length_required");
  if (status === 400) return { key: "dict.upload.badRequest" };
  return describeProblem(status, problem);
}

export interface RunnerDeps {
  queue: readonly QueuedFile[];
  /** One request for one file. A bug throws out of the runner; a lost answer is an `unknown` outcome. */
  upload: (file: Blob, signal: AbortSignal) => Promise<WriteOutcome<AdminMediaUpload>>;
  /** Ends the whole queue, also the request in flight (the screen went away). */
  signal: AbortSignal;
  /** True once the admin cancelled the files that still wait; the request in flight finishes. */
  isCancelled: () => boolean;
  onState: (id: number, state: UploadState) => void;
  /** Puts one uploaded file into the list or the field. False when it no longer fits. */
  accept: (upload: AdminMediaUpload) => boolean;
}

/**
 * Sends the queued files one after the other. For each file: `uploading`, one request, then `added`, `failed(reason)` or
 * `unknown`. Files that are never started (cancelled, the screen left, or the session ended) become `cancelled`.
 */
export async function runUploadQueue(deps: RunnerDeps): Promise<void> {
  let sessionEnded = false;
  for (const entry of deps.queue) {
    if (sessionEnded || deps.signal.aborted || deps.isCancelled()) {
      deps.onState(entry.id, { status: "cancelled" });
      continue;
    }
    deps.onState(entry.id, { status: "uploading" });
    const outcome = await deps.upload(entry.file, deps.signal);
    switch (outcome.kind) {
      case "ok":
        deps.onState(
          entry.id,
          deps.accept(outcome.data)
            ? { status: "added", url: outcome.data.url }
            : { status: "failed", message: { key: "dict.upload.reject.noRoom" } },
        );
        break;
      case "problem":
        deps.onState(entry.id, {
          status: "failed",
          message: describeUploadProblem(outcome.status, outcome.problem, outcome.retryAfter),
        });
        if (outcome.status === 401 || outcome.status === 403) sessionEnded = true;
        break;
      case "unknown":
      case "aborted":
        // No answer, or the request was cut off: the file may have been stored.
        deps.onState(entry.id, { status: "unknown" });
        break;
    }
  }
}

export interface UploadSummary {
  /** Files that went to the queue (everything not refused before a request). */
  total: number;
  added: number;
  /** Failed, lost answer or cancelled. */
  notUploaded: number;
  /** Still waiting or in flight. */
  waiting: number;
  /** Refused before any request. */
  rejected: number;
}

export function summarizeUploads(items: readonly UploadItem[]): UploadSummary {
  const summary: UploadSummary = { total: 0, added: 0, notUploaded: 0, waiting: 0, rejected: 0 };
  for (const item of items) {
    switch (item.state.status) {
      case "rejected":
        summary.rejected += 1;
        continue;
      case "added":
        summary.added += 1;
        break;
      case "failed":
      case "unknown":
      case "cancelled":
        summary.notUploaded += 1;
        break;
      default:
        summary.waiting += 1;
    }
    summary.total += 1;
  }
  return summary;
}

/** The live region's text: "3 of 7 uploaded", then how many did not go through. */
export function summaryMessages(summary: UploadSummary): MessageDescriptor[] {
  const messages: MessageDescriptor[] = [];
  if (summary.total > 0) {
    messages.push({
      key: "dict.upload.summary",
      values: { done: summary.added, total: summary.total },
    });
  } else if (summary.rejected > 0) messages.push({ key: "dict.upload.summaryNone" });
  const problems = summary.notUploaded + summary.rejected;
  if (problems > 0)
    messages.push({ key: "dict.upload.summaryProblems", values: { count: problems } });
  return messages;
}

// ------------------------------------------------------------------------------------------------ drops

/** The part of a drag-and-drop item the code reads (a `DataTransferItem`). */
export interface DroppedEntry {
  kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry?: () => { isDirectory: boolean } | null;
}

/** The part of a `DataTransfer` the code reads. */
export interface DroppedData {
  items?: ArrayLike<DroppedEntry>;
  files?: ArrayLike<File>;
}

/**
 * The files of a drop. Folders and items that are not files (text, links) are ignored and counted. Must be called while
 * the drop event is handled: the browser empties the data afterwards.
 */
export function filesFromDrop(data: DroppedData): { files: File[]; ignored: number } {
  const files: File[] = [];
  let ignored = 0;
  const items = data.items === undefined ? [] : Array.from(data.items);
  if (items.length > 0) {
    for (const item of items) {
      const file =
        item.kind !== "file" || item.webkitGetAsEntry?.()?.isDirectory === true
          ? null
          : item.getAsFile();
      if (file === null) ignored += 1;
      else files.push(file);
    }
    return { files, ignored };
  }
  return { files: Array.from(data.files ?? []), ignored: 0 };
}

/** The note after a drop that gave nothing to upload, or skipped some items; `null` when nothing was skipped. */
export function dropNotice(fileCount: number, ignored: number): MessageDescriptor | null {
  if (fileCount === 0) return { key: "dict.upload.dropNothing" };
  if (ignored > 0) return { key: "dict.upload.dropSkipped", values: { count: ignored } };
  return null;
}
