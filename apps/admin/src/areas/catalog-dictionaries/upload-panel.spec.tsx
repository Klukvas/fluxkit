import { describe, expect, it } from "vitest";
import { keepFileDialogClosed } from "./upload-panel";

/** The file input's lock while a queue runs (step 9 review L-1): no file dialog, but no `disabled` either. */
describe("keepFileDialogClosed", () => {
  function click() {
    let prevented = false;
    return {
      event: {
        preventDefault: () => {
          prevented = true;
        },
      },
      prevented: () => prevented,
    };
  }

  it("keeps the file dialog closed while the queue runs", () => {
    const running = click();
    keepFileDialogClosed(true, running.event);
    expect(running.prevented()).toBe(true);
  });

  it("lets the dialog open when no queue runs", () => {
    const idle = click();
    keepFileDialogClosed(false, idle.event);
    expect(idle.prevented()).toBe(false);
  });
});
