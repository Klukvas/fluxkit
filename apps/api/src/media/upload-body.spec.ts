import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProblemException } from "../common/problem.js";
import { checkUploadLength, readBodyToFile } from "./upload-body.js";

function problemOf(run: () => unknown): ProblemException {
  try {
    run();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error("expected a problem");
}

describe("checkUploadLength (before a byte of the body is read)", () => {
  const MAX = 1024;

  it("answers 411 length_required without Content-Length or with chunked transfer", () => {
    for (const headers of [
      {},
      { "transfer-encoding": "chunked" },
      { "transfer-encoding": "chunked", "content-length": "10" },
      { "transfer-encoding": "gzip, chunked" },
    ]) {
      const problem = problemOf(() => checkUploadLength(headers, MAX));
      expect(problem.getStatus(), JSON.stringify(headers)).toBe(411);
      expect(problem.code).toBe("validation_failed");
      expect(problem.errors).toEqual([
        expect.objectContaining({ path: "body", code: "length_required" }),
      ]);
    }
  });

  it("answers 413 file_too_large for a declared length above the limit, and accepts the limit itself", () => {
    expect(checkUploadLength({ "content-length": String(MAX) }, MAX)).toBe(MAX);
    for (const length of [MAX + 1, 10 * MAX, Number.MAX_SAFE_INTEGER]) {
      const problem = problemOf(() => checkUploadLength({ "content-length": String(length) }, MAX));
      expect(problem.getStatus()).toBe(413);
      expect(problem.code).toBe("validation_failed");
      expect(problem.errors).toEqual([
        expect.objectContaining({ path: "body", code: "file_too_large" }),
      ]);
    }
    const huge = problemOf(() =>
      checkUploadLength({ "content-length": "99999999999999999999999999" }, MAX),
    );
    expect(huge.getStatus()).toBe(413);
  });

  it("answers 400 empty_file for a zero length", () => {
    const problem = problemOf(() => checkUploadLength({ "content-length": "0" }, MAX));
    expect(problem.getStatus()).toBe(400);
    expect(problem.errors).toEqual([expect.objectContaining({ path: "body", code: "empty_file" })]);
  });

  it("answers 411 for a Content-Length that is not a plain number", () => {
    for (const value of ["-1", "1e3", "0x10", " 10", "10 ", "", "ten"]) {
      expect(problemOf(() => checkUploadLength({ "content-length": value }, MAX)).getStatus()).toBe(
        411,
      );
    }
  });
});

describe("readBodyToFile (the stream counter)", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "fluxkit-upload-body-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** A source that records how many chunks were pulled from it. */
  function source(chunks: Buffer[]): { stream: Readable; pulled: () => number } {
    let pulled = 0;
    async function* generate(): AsyncGenerator<Buffer> {
      for (const chunk of chunks) {
        pulled += 1;
        yield chunk;
      }
    }
    return { stream: Readable.from(generate()), pulled: () => pulled };
  }

  it("writes exactly the limit and reports the byte count", async () => {
    const path = join(directory, "body");
    const handle = await open(path, "wx", 0o640);
    const { stream } = source([Buffer.alloc(600, 1), Buffer.alloc(424, 2)]);
    expect(await readBodyToFile(stream, handle, 1024)).toBe(1024);
    await handle.close();
    expect((await readFile(path)).length).toBe(1024);
  });

  it("cuts a lying client off at limit + 1 byte with 413 file_too_large and stops reading", async () => {
    const path = join(directory, "body");
    const handle = await open(path, "wx", 0o640);
    const chunks = [
      Buffer.alloc(1024, 1),
      Buffer.alloc(1, 2),
      ...Array(50).fill(Buffer.alloc(1000)),
    ];
    const { stream, pulled } = source(chunks);
    const error = await readBodyToFile(stream, handle, 1024).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await handle.close();
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).getStatus()).toBe(413);
    expect((error as ProblemException).errors).toEqual([
      expect.objectContaining({ path: "body", code: "file_too_large" }),
    ]);
    // Nothing beyond the limit reached the disk, and the source was not drained.
    expect((await readFile(path)).length).toBeLessThanOrEqual(1024);
    expect(pulled()).toBeLessThan(5);
  });

  it("passes a failing source on instead of returning a short count", async () => {
    const handle = await open(join(directory, "body"), "wx", 0o640);
    const failing = new Readable({
      read() {
        this.destroy(new Error("client went away"));
      },
    });
    await expect(readBodyToFile(failing, handle, 1024)).rejects.toThrow("client went away");
    await handle.close();
  });
});
