import { createInterface } from "node:readline";
import { Writable, type Readable } from "node:stream";

export interface HiddenPrompter {
  /** Writes `question` and resolves with the typed line. What is typed is never written to the output. */
  ask(question: string): Promise<string>;
  close(): void;
}

/**
 * Reads lines without echo, with node `readline` and no dependency. readline echoes typed characters to its
 * output stream; that stream is a sink here, while the question itself goes to the real output.
 * One interface serves all questions: two interfaces on one stdin can lose buffered input.
 */
export function createHiddenPrompter(
  input: Readable,
  output: NodeJS.WritableStream,
): HiddenPrompter {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const lines = createInterface({ input, output: sink, terminal: true });
  let rejectPending: ((error: Error) => void) | undefined;
  // Ctrl-D, Ctrl-C or a closed pipe end the interface; without this the promise would never settle.
  lines.on("close", () => {
    rejectPending?.(new Error("The input ended before the password was entered."));
  });

  return {
    ask(question) {
      return new Promise<string>((resolve, reject) => {
        rejectPending = reject;
        output.write(question);
        lines.question("", (answer) => {
          rejectPending = undefined;
          output.write("\n");
          resolve(answer);
        });
      });
    },
    close() {
      rejectPending = undefined;
      lines.close();
    },
  };
}
