import type { AdminMediaUpload } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import type { WriteOutcome } from "../../lib/run-write";
import { createUploadController, type ControllerState } from "./upload-controller";

type Outcome = WriteOutcome<AdminMediaUpload>;
const limits = { maxBytes: 1000, contentTypes: ["image/jpeg", "image/png"] };
const file = (name: string, size = 10, type = "image/jpeg") =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1 });
const result = (name: string): Outcome => ({
  kind: "ok",
  status: 201,
  data: {
    id: name,
    url: `https://shop.example/media/${name}.jpg`,
    contentType: "image/jpeg",
    byteSize: 1,
    width: 1,
    height: 1,
    createdAt: "2026-10-23T10:00:00.000Z",
  },
});

/** An upload the test finishes by hand, so it can look at the controller while a request is in flight. */
function gate() {
  const calls: { file: Blob; signal: AbortSignal; finish: (outcome: Outcome) => void }[] = [];
  const upload = (blob: Blob, signal: AbortSignal) =>
    new Promise<Outcome>((resolve) => {
      calls.push({ file: blob, signal, finish: resolve });
    });
  return { calls, upload };
}

function setup(rowCount = 0, accept: (upload: AdminMediaUpload) => boolean = () => true) {
  const { calls, upload } = gate();
  const accepted: string[] = [];
  const snapshots: ControllerState[] = [];
  const controller = createUploadController({
    limits,
    maxRows: 100,
    maxFiles: 20,
    rowCount: () => rowCount,
    accept: (uploaded) => {
      accepted.push(uploaded.url);
      return accept(uploaded);
    },
    upload,
    onChange: (state) => snapshots.push(state),
  });
  return { controller, calls, accepted, snapshots };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the upload controller (one queue per screen)", () => {
  it("is idle at first", () => {
    const { controller } = setup();
    expect(controller.state()).toEqual({ items: [], running: false, notice: null });
    expect(controller.pending()).toBe(false);
  });

  it("starts one queue; a second start while it runs sends nothing (double click)", async () => {
    const { controller, calls } = setup();
    const first = controller.start([file("a.jpg"), file("b.jpg")]);
    const second = controller.start([file("c.jpg")]);
    expect(second).toBeNull();
    expect(controller.state().running).toBe(true);
    expect(controller.pending()).toBe(true);
    await tick();
    expect(calls).toHaveLength(1);
    calls[0]?.finish(result("a"));
    await tick();
    calls[1]?.finish(result("b"));
    await first;
    expect(calls).toHaveLength(2);
    expect(controller.state().running).toBe(false);
    expect(controller.pending()).toBe(false);
  });

  it("sends one file at a time and shows each file's state; ids go on across selections", async () => {
    const { controller, calls, accepted } = setup();
    const run = controller.start([file("a.jpg"), file("b.jpg"), file("bad.gif", 10, "image/gif")]);
    await tick();
    expect(controller.state().items.map((item) => item.state.status)).toEqual([
      "uploading",
      "queued",
      "rejected",
    ]);
    calls[0]?.finish(result("a"));
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]?.finish({ kind: "unknown", failure: { kind: "timeout" } });
    await run;
    expect(controller.state().items.map((item) => item.state.status)).toEqual([
      "added",
      "unknown",
      "rejected",
    ]);
    expect(accepted).toEqual(["https://shop.example/media/a.jpg"]);

    const again = controller.start([file("c.jpg")]);
    await tick();
    calls[2]?.finish(result("c"));
    await again;
    expect(controller.state().items.map((item) => item.id)).toEqual([4]);
  });

  it("counts the rows the list has when the selection is made", async () => {
    const { controller, calls } = setup(100);
    const run = controller.start([file("a.jpg")]);
    await run;
    expect(calls).toHaveLength(0);
    expect(controller.state().items[0]?.state).toEqual({ status: "rejected", reason: "noRoom" });
    expect(controller.state().running).toBe(false);
  });

  it("cancels the files that wait at once; the request in flight finishes and is kept", async () => {
    const { controller, calls, accepted } = setup();
    const run = controller.start([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    await tick();
    controller.cancelQueued();
    expect(controller.state().items.map((item) => item.state.status)).toEqual([
      "uploading",
      "cancelled",
      "cancelled",
    ]);
    calls[0]?.finish(result("a"));
    await run;
    expect(calls).toHaveLength(1);
    expect(accepted).toEqual(["https://shop.example/media/a.jpg"]);
    expect(controller.state().items.map((item) => item.state.status)).toEqual([
      "added",
      "cancelled",
      "cancelled",
    ]);
  });

  it("ends everything, the request in flight included, when the screen goes away", async () => {
    const { controller, calls } = setup();
    const run = controller.start([file("a.jpg"), file("b.jpg")]);
    await tick();
    expect(calls[0]?.signal.aborted).toBe(false);
    controller.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.finish({ kind: "aborted" });
    await run;
    expect(calls).toHaveLength(1);
  });

  it("puts the note of a drop that skipped items or gave no file in the state, and clears it with the next selection", async () => {
    const { controller, calls } = setup();
    void controller.start([], 2);
    expect(controller.state().notice).toEqual({ key: "dict.upload.dropNothing" });
    const run = controller.start([file("a.jpg")], 1);
    expect(controller.state().notice).toEqual({
      key: "dict.upload.dropSkipped",
      values: { count: 1 },
    });
    await tick();
    calls[0]?.finish(result("a"));
    await run;
    const next = controller.start([file("b.jpg")]);
    expect(controller.state().notice).toBeNull();
    await tick();
    calls[1]?.finish(result("b"));
    await next;
  });

  it("clears the finished list, but never while it runs", async () => {
    const { controller, calls } = setup();
    const run = controller.start([file("a.jpg")]);
    controller.dismiss();
    expect(controller.state().items).toHaveLength(1);
    await tick();
    calls[0]?.finish(result("a"));
    await run;
    controller.dismiss();
    expect(controller.state().items).toEqual([]);
  });

  it("passes a bug out of the returned promise and frees the screen", async () => {
    const controller = createUploadController({
      limits,
      maxRows: 100,
      maxFiles: 20,
      rowCount: () => 0,
      accept: () => true,
      upload: () => Promise.reject(new Error("bug")),
      onChange: () => undefined,
    });
    await expect(controller.start([file("a.jpg")])).rejects.toThrow("bug");
    expect(controller.state().running).toBe(false);
    expect(controller.pending()).toBe(false);
  });
});
