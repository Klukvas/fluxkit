import { describe, expect, it } from "vitest";
import * as core from "../index.js";
import { MEDIA_STORAGE_PORT, type MediaReadable, type MediaStoragePort } from "./storage-port.js";

describe("the media storage port contract (ADR 0028 decision 2)", () => {
  it("has the token the API injects, distinct from the other ports", () => {
    expect(MEDIA_STORAGE_PORT).toBe("fluxkit:media-storage-port");
    expect(MEDIA_STORAGE_PORT).not.toBe(core.ORDER_READ_PORT);
    expect(MEDIA_STORAGE_PORT).not.toBe(core.ORDER_PAYMENTS_PORT);
  });

  it("is exported from the package entry point", () => {
    expect(core.MEDIA_STORAGE_PORT).toBe(MEDIA_STORAGE_PORT);
  });

  it("can be implemented by a plain in-memory object (a driver test double)", async () => {
    const files = new Map<string, Uint8Array>();
    const port: MediaStoragePort = {
      put: (key) => {
        if (files.has(key)) {
          return Promise.reject(new Error("exists"));
        }
        files.set(key, new Uint8Array(3));
        return Promise.resolve();
      },
      open: (key) => {
        const file = files.get(key);
        if (file === undefined) {
          return Promise.resolve(undefined);
        }
        let sent = false;
        const stream: MediaReadable = {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              const done = sent;
              sent = true;
              return Promise.resolve(
                done ? { done: true, value: undefined } : { done: false, value: file },
              );
            },
          }),
          destroy: () => undefined,
        };
        return Promise.resolve({ stream, byteSize: file.byteLength });
      },
      delete: (key) => {
        files.delete(key);
        return Promise.resolve();
      },
    };
    expect(Object.keys(port).sort()).toEqual(["delete", "open", "put"]);
    const key = "3f2a9c0d1b7e4f6a8c5d2e1f00aabbcc.webp";
    if (!core.isMediaKey(key)) {
      expect.unreachable();
    }
    await port.put(key, "/tmp/x", "image/webp");
    const opened = await port.open(key);
    expect(opened?.byteSize).toBe(3);
    await port.delete(key);
    await port.delete(key);
    expect(await port.open(key)).toBeUndefined();
  });
});
