import { NetworkError, type AdminResult } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { createFormWriter } from "./use-form-submit";
import { IDLE_SUBMIT, type SubmitState } from "./submit-errors";

/** A write the test answers by hand, and a log of the writer's state changes. */
function harness() {
  const states: SubmitState[] = [];
  const crashes: unknown[] = [];
  let focused = 0;
  const writer = createFormWriter({
    setState: (state) => states.push(state),
    crash: (bug) => crashes.push(bug),
    focusSummary: () => {
      focused += 1;
    },
    fields: () => ["name"],
    mapProblem: () => undefined,
  });
  const sent: ((result: AdminResult<string>) => void)[] = [];
  const write = () =>
    new Promise<AdminResult<string>>((answer) => {
      sent.push(answer);
    });
  return { writer, states, crashes, sent, write, focused: () => focused };
}

const ok: AdminResult<string> = { ok: true, status: 200, data: "saved" };

describe("createFormWriter (the write half of useFormSubmit)", () => {
  it("sends ONE write for two submits in the same task; the second answers aborted and leaves the state alone", async () => {
    const { writer, states, sent, write } = harness();
    const first = writer.submit(write);
    const second = writer.submit(write);
    expect(sent).toHaveLength(1);
    expect(await second).toEqual({ kind: "aborted" });
    expect(states).toEqual([{ ...IDLE_SUBMIT, busy: true }]);
    sent[0]?.(ok);
    expect(await first).toEqual({ kind: "ok", status: 200, data: "saved" });
    expect(states).toEqual([{ ...IDLE_SUBMIT, busy: true }, IDLE_SUBMIT]);
  });

  it("sets busy before the request leaves, and frees the form after any answer (never repeats a write)", async () => {
    const { writer, states, sent, write } = harness();
    const first = writer.submit(write);
    expect(states.at(-1)?.busy).toBe(true);
    sent[0]?.({
      ok: false,
      status: 409,
      problem: { type: "about:blank", title: "t", detail: "d", status: 409, code: "conflict" },
      retryAfter: null,
    });
    expect((await first).kind).toBe("problem");
    expect(sent).toHaveLength(1);
    const again = writer.submit(write);
    expect(sent).toHaveLength(2);
    sent[1]?.(ok);
    expect((await again).kind).toBe("ok");
  });

  it("frees the form after a lost answer and after a bug (the bug goes to the error boundary)", async () => {
    const { writer, crashes, sent, write } = harness();
    const lost = writer.submit(() =>
      Promise.reject(new NetworkError("offline", { cause: null, aborted: false })),
    );
    expect((await lost).kind).toBe("unknown");
    const bug = new Error("a bug");
    const broken = writer.submit(() => {
      throw bug;
    });
    expect(await broken).toEqual({ kind: "aborted" });
    expect(crashes).toEqual([bug]);
    void writer.submit(write);
    expect(sent).toHaveLength(1);
  });

  it("focuses the summary when the answer has messages for it", async () => {
    const { writer, sent, write, focused } = harness();
    const refused = writer.submit(write);
    sent[0]?.({
      ok: false,
      status: 409,
      problem: { type: "about:blank", title: "t", detail: "d", status: 409, code: "conflict" },
      retryAfter: null,
    });
    await refused;
    expect(focused()).toBe(1);
  });
});
