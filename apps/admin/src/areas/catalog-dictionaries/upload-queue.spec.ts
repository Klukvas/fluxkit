import type { AdminMediaUpload, ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import type { WriteOutcome } from "../../lib/run-write";
import {
  MAX_FILES_PER_SELECTION,
  acceptAttribute,
  describeUploadProblem,
  dropNotice,
  filesFromDrop,
  planUploads,
  rejectionMessage,
  runUploadQueue,
  stateMessage,
  summarizeUploads,
  summaryMessages,
  type PlanContext,
  type UploadItem,
  type UploadState,
} from "./upload-queue";

const limits = { maxBytes: 1000, contentTypes: ["image/jpeg", "image/png", "image/webp"] };
const context = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  rowCount: 0,
  maxRows: 100,
  maxFiles: MAX_FILES_PER_SELECTION,
  limits,
  firstId: 1,
  ...overrides,
});

function file(name: string, size = 10, type = "image/jpeg", lastModified = 1): File {
  return new File([new Uint8Array(size)], name, { type, lastModified });
}

const many = (count: number, type = "image/jpeg") =>
  Array.from({ length: count }, (_, index) => file(`f${index}.jpg`, 10, type, index));

describe("planUploads: checks before any request", () => {
  it("queues valid files in the selection's order with consecutive ids, all waiting", () => {
    const plan = planUploads([file("a.jpg"), file("b.png", 20, "image/png")], context());
    expect(plan.queue.map((entry) => entry.id)).toEqual([1, 2]);
    expect(plan.items.map((item) => [item.id, item.name, item.state.status])).toEqual([
      [1, "a.jpg", "queued"],
      [2, "b.png", "queued"],
    ]);
  });

  it("starts the ids where the caller says (a later selection never reuses an id)", () => {
    const plan = planUploads([file("a.jpg")], context({ firstId: 41 }));
    expect(plan.queue.map((entry) => entry.id)).toEqual([41]);
  });

  it("rejects a zero-byte file as empty, before the type", () => {
    const plan = planUploads([file("a.gif", 0, "image/gif")], context());
    expect(plan.queue).toEqual([]);
    expect(plan.items[0]?.state).toEqual({ status: "rejected", reason: "emptyFile" });
  });

  it("rejects a type that is not in the server's list, whatever the file name says", () => {
    const rejected = [
      file("a.svg", 10, "image/svg+xml"),
      file("a.gif", 10, "image/gif"),
      file("renamed.jpg", 10, "text/plain"),
      file("unknown.jpg", 10, ""),
      file("a.pdf", 10, "application/pdf"),
    ];
    const plan = planUploads(rejected, context());
    expect(plan.queue).toEqual([]);
    for (const item of plan.items) {
      expect(item.state, item.name).toEqual({ status: "rejected", reason: "unsupportedType" });
    }
  });

  it("compares the type without regard to case, and only against the configured list", () => {
    expect(planUploads([file("a.jpg", 10, "IMAGE/JPEG")], context()).queue).toHaveLength(1);
    const narrow = { maxBytes: 1000, contentTypes: ["image/png"] };
    const plan = planUploads(
      [file("a.jpg"), file("b.png", 10, "image/png")],
      context({ limits: narrow }),
    );
    expect(plan.queue.map((entry) => entry.id)).toEqual([2]);
    expect(plan.items[0]?.state).toEqual({ status: "rejected", reason: "unsupportedType" });
  });

  it("rejects a file above the size limit and accepts one exactly at it", () => {
    const plan = planUploads([file("big.jpg", 1001), file("edge.jpg", 1000)], context());
    expect(plan.items[0]?.state).toEqual({ status: "rejected", reason: "fileTooLarge" });
    expect(plan.queue.map((entry) => entry.id)).toEqual([2]);
  });

  it("takes at most 20 files of one selection: the 21st and later are rejected, valid or not", () => {
    const plan = planUploads(many(25), context());
    expect(plan.queue).toHaveLength(20);
    expect(plan.items.slice(20).map((item) => item.state)).toEqual(
      Array(5).fill({ status: "rejected", reason: "tooManyFiles" }),
    );
    // Invalid files among the first 20 still use up their places.
    const mixed = [...many(3, "image/gif"), ...many(20)];
    const mixedPlan = planUploads(mixed, context());
    expect(mixedPlan.queue).toHaveLength(17);
    expect(mixedPlan.items.filter((item) => item.state.status === "rejected")).toHaveLength(6);
  });

  it("counts the rows already in the list: the 101st row is never uploaded", () => {
    const plan = planUploads(many(5), context({ rowCount: 98 }));
    expect(plan.queue).toHaveLength(2);
    expect(plan.items.slice(2).map((item) => item.state)).toEqual(
      Array(3).fill({ status: "rejected", reason: "noRoom" }),
    );
    expect(planUploads(many(2), context({ rowCount: 100 })).queue).toEqual([]);
    expect(planUploads(many(2), context({ rowCount: 130 })).queue).toEqual([]);
  });

  it("does not let a rejected file use up a place in the list", () => {
    const plan = planUploads([file("e.jpg", 0), ...many(2)], context({ rowCount: 98 }));
    expect(plan.queue).toHaveLength(2);
  });

  it("rejects a repeat of the same file in one selection and keeps two different files of one name", () => {
    const same = file("a.jpg", 10, "image/jpeg", 5);
    const plan = planUploads(
      [same, file("a.jpg", 10, "image/jpeg", 5), file("a.jpg", 11, "image/jpeg", 5), same],
      context(),
    );
    expect(plan.items.map((item) => item.state)).toEqual([
      { status: "queued" },
      { status: "rejected", reason: "duplicate" },
      { status: "queued" },
      { status: "rejected", reason: "duplicate" },
    ]);
  });

  it("takes one file in single mode (brand logo): the second is rejected", () => {
    const plan = planUploads(many(2), context({ maxFiles: 1, maxRows: 1 }));
    expect(plan.queue).toHaveLength(1);
    expect(plan.items[1]?.state).toEqual({ status: "rejected", reason: "tooManyFiles" });
  });

  it("returns an empty plan for no files", () => {
    expect(planUploads([], context())).toEqual({ items: [], queue: [] });
  });
});

describe("messages of the checks and states", () => {
  it("name the limits the server's config gave", () => {
    expect(rejectionMessage("fileTooLarge", limits)).toEqual({
      key: "dict.upload.reject.fileTooLarge",
      values: { max: 0.1 },
    });
    expect(
      rejectionMessage("fileTooLarge", { maxBytes: 10 * 1024 * 1024, contentTypes: [] }).values,
    ).toEqual({ max: 10 });
    expect(rejectionMessage("unsupportedType", limits)).toEqual({
      key: "dict.upload.reject.unsupportedType",
      values: { types: "jpeg, png, webp" },
    });
    expect(rejectionMessage("tooManyFiles", limits, 20)).toEqual({
      key: "dict.upload.reject.tooManyFiles",
      values: { max: 20 },
    });
    expect(rejectionMessage("noRoom", limits).key).toBe("dict.upload.reject.noRoom");
    expect(rejectionMessage("emptyFile", limits).key).toBe("dict.upload.reject.emptyFile");
    expect(rejectionMessage("duplicate", limits).key).toBe("dict.upload.reject.duplicate");
  });

  it("say the lost-answer state may have stored the file", () => {
    expect(stateMessage({ status: "unknown" }, limits)).toEqual({ key: "dict.upload.unknown" });
    expect(stateMessage({ status: "queued" }, limits).key).toBe("dict.upload.state.queued");
    expect(stateMessage({ status: "uploading" }, limits).key).toBe("dict.upload.state.uploading");
    expect(stateMessage({ status: "added", url: "u" }, limits).key).toBe("dict.upload.state.added");
    expect(stateMessage({ status: "cancelled" }, limits).key).toBe("dict.upload.state.cancelled");
    const failed = { key: "errors.reason.corrupt_image" };
    expect(stateMessage({ status: "failed", message: failed }, limits)).toBe(failed);
  });

  it("builds the file input's accept attribute from the config's types", () => {
    expect(acceptAttribute(["image/png", "image/webp"])).toBe("image/png,image/webp");
    expect(acceptAttribute([])).toBe("");
  });
});

function problem(status: number, code: string, errors?: { path: string; code: string }[]) {
  return {
    type: "about:blank",
    title: "t",
    status,
    code,
    detail: "SECRET-ENGLISH-DETAIL",
    ...(errors === undefined ? {} : { errors }),
  } as ProblemDetails;
}

describe("describeUploadProblem: every server answer has a translated message", () => {
  const reasons = [
    "empty_file",
    "unsupported_type",
    "corrupt_image",
    "animated_not_supported",
    "dimensions_too_large",
    "too_many_pixels",
    "processing_timeout",
    "output_too_large",
  ];
  it.each(reasons)("maps the 400 reason %s", (reason) => {
    expect(
      describeUploadProblem(
        400,
        problem(400, "validation_failed", [{ path: "body", code: reason }]),
        null,
      ),
    ).toEqual({ key: `errors.reason.${reason}` });
  });

  it("maps 413 and 411 to their own reasons, never to the 100 KB JSON message", () => {
    expect(describeUploadProblem(413, problem(413, "validation_failed"), null)).toEqual({
      key: "errors.reason.file_too_large",
    });
    expect(
      describeUploadProblem(
        413,
        problem(413, "validation_failed", [{ path: "body", code: "file_too_large" }]),
        null,
      ),
    ).toEqual({ key: "errors.reason.file_too_large" });
    expect(
      describeUploadProblem(
        411,
        problem(411, "validation_failed", [{ path: "body", code: "length_required" }]),
        null,
      ),
    ).toEqual({ key: "errors.reason.length_required" });
    expect(describeUploadProblem(411, problem(411, "validation_failed"), null).key).toBe(
      "errors.reason.length_required",
    );
  });

  it("maps the 503 codes, the session answers and a 400 without a reason", () => {
    expect(describeUploadProblem(503, problem(503, "storage_unavailable"), null)).toEqual({
      key: "errors.code.storage_unavailable",
    });
    expect(describeUploadProblem(503, problem(503, "uploads_disabled"), null)).toEqual({
      key: "errors.code.uploads_disabled",
    });
    expect(describeUploadProblem(401, problem(401, "unauthorized"), null).key).toBe(
      "errors.code.unauthorized",
    );
    expect(describeUploadProblem(403, problem(403, "forbidden"), null).key).toBe(
      "errors.code.forbidden",
    );
    expect(describeUploadProblem(400, problem(400, "validation_failed"), null)).toEqual({
      key: "dict.upload.badRequest",
    });
  });

  it("names the wait of a 429 from Retry-After, in whole minutes rounded up", () => {
    expect(describeUploadProblem(429, problem(429, "too_many_requests"), "120")).toEqual({
      key: "dict.upload.rateLimited",
      values: { minutes: 2 },
    });
    expect(describeUploadProblem(429, problem(429, "too_many_requests"), "5")).toEqual({
      key: "dict.upload.rateLimited",
      values: { minutes: 1 },
    });
    expect(describeUploadProblem(429, problem(429, "too_many_requests"), null)).toEqual({
      key: "errors.code.too_many_requests",
    });
    expect(describeUploadProblem(429, problem(429, "too_many_requests"), "soon")).toEqual({
      key: "errors.code.too_many_requests",
    });
  });

  it("shows the generic message with the code for a reason it does not know, and never the English detail", () => {
    const descriptor = describeUploadProblem(
      400,
      problem(400, "validation_failed", [{ path: "body", code: "brand_new_reason" }]),
      null,
    );
    expect(descriptor).toEqual({ key: "errors.generic", code: "brand_new_reason" });
    expect(JSON.stringify(descriptor)).not.toContain("SECRET");
  });
});

// ------------------------------------------------------------------------------------------------ the runner

const uploaded = (name: string): AdminMediaUpload => ({
  id: `id-${name}`,
  url: `https://shop.example/media/${name}.jpg`,
  contentType: "image/jpeg",
  byteSize: 5,
  width: 1,
  height: 1,
  createdAt: "2026-10-23T10:00:00.000Z",
});

type Outcome = WriteOutcome<AdminMediaUpload>;
const ok = (name: string): Outcome => ({ kind: "ok", status: 201, data: uploaded(name) });
const refused = (status: number, code: string, retryAfter: string | null = null): Outcome => ({
  kind: "problem",
  status,
  retryAfter,
  problem: problem(status, code),
});
const lost: Outcome = { kind: "unknown", failure: { kind: "network" } };

function harness(
  outcomes: (Outcome | ((file: Blob, signal: AbortSignal) => Promise<Outcome>))[],
  options: { cancelAfter?: number; abortAt?: number; acceptNo?: number } = {},
) {
  const files = outcomes.map((_, index) => file(`f${index}.jpg`));
  const plan = planUploads(files, context());
  const controller = new AbortController();
  const states = new Map<number, UploadState[]>();
  const accepted: string[] = [];
  const calls: { file: Blob; signal: AbortSignal }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const upload = async (blob: Blob, signal: AbortSignal): Promise<Outcome> => {
    calls.push({ file: blob, signal });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    try {
      const outcome = outcomes[calls.length - 1] as
        Outcome | ((file: Blob, signal: AbortSignal) => Promise<Outcome>);
      if (options.abortAt === calls.length) controller.abort();
      return typeof outcome === "function" ? await outcome(blob, signal) : outcome;
    } finally {
      inFlight -= 1;
    }
  };
  const run = () =>
    runUploadQueue({
      queue: plan.queue,
      upload,
      signal: controller.signal,
      isCancelled: () => options.cancelAfter !== undefined && calls.length >= options.cancelAfter,
      onState: (id, state) => states.set(id, [...(states.get(id) ?? []), state]),
      accept: (result) => {
        accepted.push(result.url);
        return options.acceptNo === undefined || accepted.length !== options.acceptNo;
      },
    });
  return { run, states, accepted, calls, plan, maxInFlight: () => maxInFlight };
}

const last = (states: Map<number, UploadState[]>, id: number) => states.get(id)?.at(-1);

describe("runUploadQueue", () => {
  it("uploads one file at a time, in order, and appends each success in that order", async () => {
    const run = harness([ok("a"), ok("b"), ok("c")]);
    await run.run();
    expect(run.maxInFlight()).toBe(1);
    expect(run.calls.map((call) => (call.file as File).name)).toEqual([
      "f0.jpg",
      "f1.jpg",
      "f2.jpg",
    ]);
    expect(run.accepted).toEqual([
      "https://shop.example/media/a.jpg",
      "https://shop.example/media/b.jpg",
      "https://shop.example/media/c.jpg",
    ]);
    expect(run.states.get(1)).toEqual([
      { status: "uploading" },
      { status: "added", url: "https://shop.example/media/a.jpg" },
    ]);
  });

  it("hands the abort signal to every upload", async () => {
    const run = harness([ok("a"), ok("b")]);
    await run.run();
    expect(run.calls.every((call) => !call.signal.aborted)).toBe(true);
    expect(run.calls).toHaveLength(2);
  });

  it("goes on after a failure: file 2 of 5 fails, the other four are added, nothing is retried", async () => {
    const run = harness([ok("a"), refused(400, "validation_failed"), ok("c"), ok("d"), ok("e")]);
    await run.run();
    expect(run.calls).toHaveLength(5);
    expect(last(run.states, 2)).toEqual({
      status: "failed",
      message: { key: "dict.upload.badRequest" },
    });
    expect(run.accepted).toHaveLength(4);
    expect([1, 3, 4, 5].map((id) => last(run.states, id)?.status)).toEqual(Array(4).fill("added"));
  });

  it("appends nothing for a refused file", async () => {
    const run = harness([refused(413, "validation_failed")]);
    await run.run();
    expect(run.accepted).toEqual([]);
    expect(last(run.states, 1)).toEqual({
      status: "failed",
      message: { key: "errors.reason.file_too_large" },
    });
  });

  it("treats a lost answer as unknown: not added, not retried, the next file goes on", async () => {
    const run = harness([lost, ok("b")]);
    await run.run();
    expect(run.calls).toHaveLength(2);
    expect(last(run.states, 1)).toEqual({ status: "unknown" });
    expect(run.accepted).toEqual(["https://shop.example/media/b.jpg"]);
  });

  it("treats an answer that cannot be read like a lost answer", async () => {
    const run = harness([{ kind: "unknown", failure: { kind: "invalidResponse" } }, ok("b")]);
    await run.run();
    expect(last(run.states, 1)).toEqual({ status: "unknown" });
  });

  it("says a request ended by the caller's abort may have been stored, and cancels the rest", async () => {
    const run = harness([ok("a"), { kind: "aborted" }, ok("c"), ok("d")], { abortAt: 2 });
    await run.run();
    expect(run.calls).toHaveLength(2);
    expect(last(run.states, 1)?.status).toBe("added");
    expect(last(run.states, 2)).toEqual({ status: "unknown" });
    expect([3, 4].map((id) => last(run.states, id))).toEqual([
      { status: "cancelled" },
      { status: "cancelled" },
    ]);
    expect(run.accepted).toHaveLength(1);
  });

  it("does not start a file once the signal is aborted, and cancels only the waiting files when asked to", async () => {
    const stopped = harness([ok("a"), ok("b"), ok("c")], { cancelAfter: 1 });
    await stopped.run();
    expect(stopped.calls).toHaveLength(1);
    expect(last(stopped.states, 1)?.status).toBe("added");
    expect([2, 3].map((id) => last(stopped.states, id))).toEqual([
      { status: "cancelled" },
      { status: "cancelled" },
    ]);
  });

  it("marks a file failed when the list had no room left for it after the upload", async () => {
    const run = harness([ok("a"), ok("b")], { acceptNo: 1 });
    await run.run();
    expect(last(run.states, 1)).toEqual({
      status: "failed",
      message: { key: "dict.upload.reject.noRoom" },
    });
    expect(last(run.states, 2)?.status).toBe("added");
  });

  it("stops after a 401 or 403 (the session ended): the rest is cancelled, not sent", async () => {
    for (const status of [401, 403]) {
      const run = harness([
        ok("a"),
        refused(status, status === 401 ? "unauthorized" : "forbidden"),
        ok("c"),
      ]);
      await run.run();
      expect(run.calls, String(status)).toHaveLength(2);
      expect(last(run.states, 2)?.status).toBe("failed");
      expect(last(run.states, 3)).toEqual({ status: "cancelled" });
    }
  });

  it("goes on after a 429 and names the wait", async () => {
    const run = harness([refused(429, "too_many_requests", "300"), ok("b")]);
    await run.run();
    expect(run.calls).toHaveLength(2);
    expect(last(run.states, 1)).toEqual({
      status: "failed",
      message: { key: "dict.upload.rateLimited", values: { minutes: 5 } },
    });
  });

  it("lets a bug (a thrown error) through instead of turning it into a state", async () => {
    const run = harness([() => Promise.reject(new Error("bug")), ok("b")]);
    await expect(run.run()).rejects.toThrow("bug");
    expect(run.calls).toHaveLength(1);
  });
});

describe("summaries for the live region", () => {
  const items = (...states: UploadState[]): UploadItem[] =>
    states.map((state, index) => ({ id: index + 1, name: `f${index}`, state }));

  it("counts files that went to the queue, those added, those that did not upload, and the refused", () => {
    const summary = summarizeUploads(
      items(
        { status: "added", url: "u" },
        { status: "added", url: "u" },
        { status: "added", url: "u" },
        { status: "failed", message: { key: "k" } },
        { status: "unknown" },
        { status: "uploading" },
        { status: "queued" },
        { status: "rejected", reason: "emptyFile" },
        { status: "cancelled" },
      ),
    );
    expect(summary).toEqual({ total: 8, added: 3, notUploaded: 3, waiting: 2, rejected: 1 });
  });

  it("reads '3 of 7 uploaded' and adds what did not go through", () => {
    expect(
      summaryMessages({ total: 7, added: 3, notUploaded: 0, waiting: 4, rejected: 0 }),
    ).toEqual([{ key: "dict.upload.summary", values: { done: 3, total: 7 } }]);
    expect(
      summaryMessages({ total: 7, added: 3, notUploaded: 2, waiting: 0, rejected: 2 }),
    ).toEqual([
      { key: "dict.upload.summary", values: { done: 3, total: 7 } },
      { key: "dict.upload.summaryProblems", values: { count: 4 } },
    ]);
    expect(
      summaryMessages({ total: 0, added: 0, notUploaded: 0, waiting: 0, rejected: 3 }),
    ).toEqual([
      { key: "dict.upload.summaryNone" },
      { key: "dict.upload.summaryProblems", values: { count: 3 } },
    ]);
    expect(
      summaryMessages({ total: 0, added: 0, notUploaded: 0, waiting: 0, rejected: 0 }),
    ).toEqual([]);
  });
});

describe("files from a drop", () => {
  const entry = (kind: string, value: File | null, directory = false) => ({
    kind,
    getAsFile: () => value,
    webkitGetAsEntry: () => ({ isDirectory: directory }),
  });

  it("takes the files and ignores folders and items that are not files", () => {
    const a = file("a.jpg");
    const b = file("b.png");
    const result = filesFromDrop({
      items: [
        entry("file", a),
        entry("file", file("folder"), true),
        entry("string", null),
        entry("file", b),
      ],
    });
    expect(result.files).toEqual([a, b]);
    expect(result.ignored).toBe(2);
  });

  it("falls back to the file list when the browser gives no items", () => {
    const a = file("a.jpg");
    expect(filesFromDrop({ files: [a] })).toEqual({ files: [a], ignored: 0 });
    expect(filesFromDrop({})).toEqual({ files: [], ignored: 0 });
  });

  it("counts a file entry that gives no file as ignored", () => {
    expect(filesFromDrop({ items: [entry("file", null)] })).toEqual({ files: [], ignored: 1 });
  });

  it("says why nothing happened, or how many items were skipped", () => {
    expect(dropNotice(0, 2)).toEqual({ key: "dict.upload.dropNothing" });
    expect(dropNotice(0, 0)).toEqual({ key: "dict.upload.dropNothing" });
    expect(dropNotice(3, 2)).toEqual({ key: "dict.upload.dropSkipped", values: { count: 2 } });
    expect(dropNotice(3, 0)).toBeNull();
  });
});
