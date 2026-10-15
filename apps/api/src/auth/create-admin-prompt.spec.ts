import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createHiddenPrompter } from "./create-admin-prompt.js";

function setup() {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });
  return { input, output, written: () => written };
}

describe("createHiddenPrompter", () => {
  it("shows the question but never echoes what is typed, and returns the answers in order", async () => {
    const { input, output, written } = setup();
    const prompter = createHiddenPrompter(input, output);
    const first = prompter.ask("Password: ");
    input.write("s3cret-typed-text\n");
    await expect(first).resolves.toBe("s3cret-typed-text");
    const second = prompter.ask("Repeat: ");
    input.write("again-typed-text\n");
    await expect(second).resolves.toBe("again-typed-text");
    prompter.close();
    expect(written()).toContain("Password: ");
    expect(written()).toContain("Repeat: ");
    expect(written()).not.toContain("typed-text");
    expect(written()).not.toContain("s3cret");
  });

  it("rejects when the input ends before an answer", async () => {
    const { input, output } = setup();
    const prompter = createHiddenPrompter(input, output);
    const pending = prompter.ask("Password: ");
    input.end();
    await expect(pending).rejects.toThrow(/input ended/i);
    prompter.close();
  });
});
