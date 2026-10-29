import { describe, expect, it, vi } from "vitest";
import { attemptErase } from "./erase-flow";

/**
 * The gate in front of the admin's erase call (privacy UI review F5): the typed word is checked before the call, in the right
 * direction. The calls are stubs; the decision is the code under test.
 */
describe("attemptErase", () => {
  function setup(typed: string, body: { subject: string } | null = { subject: "a@example.test" }) {
    const buildBody = vi.fn(() => body);
    const send = vi.fn((sent: { subject: string }) => Promise.resolve(`sent ${sent.subject}`));
    const run = () => attemptErase({ typed, expectedWord: "ERASE", buildBody, send });
    return { buildBody, send, run };
  }

  it("sends nothing, and builds no body, for a WRONG word", async () => {
    for (const typed of ["", "eras", "erase it", "DELETE"]) {
      const { buildBody, send, run } = setup(typed);
      expect(await run(), typed).toEqual({ kind: "word_mismatch" });
      expect(send, typed).not.toHaveBeenCalled();
      expect(buildBody, typed).not.toHaveBeenCalled();
    }
  });

  it("sends once for the RIGHT word, in any case and with spaces around it", async () => {
    for (const typed of ["ERASE", "erase", "  Erase "]) {
      const { send, run } = setup(typed);
      expect(await run(), typed).toEqual({ kind: "sent", outcome: "sent a@example.test" });
      expect(send, typed).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ subject: "a@example.test" });
    }
  });

  it("sends nothing when the word matched but the address has no valid body", async () => {
    const { send, run } = setup("ERASE", null);
    expect(await run()).toEqual({ kind: "no_body" });
    expect(send).not.toHaveBeenCalled();
  });
});
