import { describe, expect, it } from "vitest";
import {
  REVOKE_DELAY_MS,
  downloadBlob,
  labelFileName,
  type DownloadAnchor,
  type DownloadEnvironment,
} from "./label-download";

function fakeEnvironment(options: { clickThrows?: boolean } = {}) {
  const events: string[] = [];
  const scheduled: { task: () => void; delayMs: number }[] = [];
  const anchor: DownloadAnchor = {
    href: "",
    download: "",
    hidden: false,
    click: () => {
      events.push(`click ${anchor.href} as ${anchor.download}`);
      if (options.clickThrows === true) throw new Error("click failed");
    },
  };
  const environment: DownloadEnvironment = {
    createObjectUrl: () => {
      events.push("create");
      return "blob:fake-1";
    },
    revokeObjectUrl: (url) => events.push(`revoke ${url}`),
    createAnchor: () => {
      events.push("attach");
      return { anchor, release: () => events.push("detach") };
    },
    schedule: (task, delayMs) => scheduled.push({ task, delayMs }),
  };
  return { environment, events, scheduled, anchor };
}

describe("downloadBlob", () => {
  it("clicks a hidden link to a temporary object URL, detaches it, and revokes the URL later, once", () => {
    const { environment, events, scheduled, anchor } = fakeEnvironment();
    downloadBlob(
      new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      "label-7K3M-9QX2.pdf",
      environment,
    );
    expect(events).toEqual([
      "create",
      "attach",
      "click blob:fake-1 as label-7K3M-9QX2.pdf",
      "detach",
    ]);
    expect(anchor.hidden).toBe(true);
    // The URL is still valid right after the click: the browser reads the blob after it.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(REVOKE_DELAY_MS);
    scheduled[0]?.task();
    expect(events.at(-1)).toBe("revoke blob:fake-1");
    expect(events.filter((event) => event.startsWith("revoke"))).toHaveLength(1);
  });

  it("revokes the URL and detaches the link even when the click throws, and lets the error out", () => {
    const { environment, events, scheduled } = fakeEnvironment({ clickThrows: true });
    expect(() => downloadBlob(new Blob(["x"]), "label.pdf", environment)).toThrow("click failed");
    expect(events).toContain("detach");
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.task();
    expect(events.at(-1)).toBe("revoke blob:fake-1");
  });
});

describe("labelFileName", () => {
  it("names the file after the order number, like the API's Content-Disposition", () => {
    expect(labelFileName("7K3M-9QX2")).toBe("label-7K3M-9QX2.pdf");
  });

  it("never lets a path, a quote or a control character into the name", () => {
    expect(labelFileName('../a"b\r\nc')).toBe("label-.._a_b__c.pdf");
    expect(labelFileName("")).toBe("label-order.pdf");
  });
});
