import { describe, expect, it } from "vitest";
import {
  REVOKE_DELAY_MS,
  downloadBlob,
  type DownloadAnchor,
  type DownloadEnvironment,
} from "./export-download";

function fakeEnvironment(log: string[]): DownloadEnvironment {
  const anchor: DownloadAnchor = {
    href: "",
    download: "",
    hidden: false,
    click: () => log.push(`click ${anchor.href} as ${anchor.download}`),
  };
  return {
    createObjectUrl: (blob) => {
      log.push(`create ${blob.type}`);
      return "blob:fake-1";
    },
    revokeObjectUrl: (url) => log.push(`revoke ${url}`),
    createAnchor: () => {
      log.push("attach");
      return { anchor, release: () => log.push("detach") };
    },
    schedule: (task, delayMs) => {
      log.push(`schedule ${delayMs}`);
      task();
    },
  };
}

describe("downloadBlob", () => {
  it("clicks a hidden link to the object URL with the file name, then detaches it and revokes the URL later", () => {
    const log: string[] = [];
    downloadBlob(
      new Blob(["{}"], { type: "application/json" }),
      "personal-data-2026-10-29.json",
      fakeEnvironment(log),
    );
    expect(log).toEqual([
      "create application/json",
      "attach",
      "click blob:fake-1 as personal-data-2026-10-29.json",
      "detach",
      `schedule ${REVOKE_DELAY_MS}`,
      "revoke blob:fake-1",
    ]);
  });
});
