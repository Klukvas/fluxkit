import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@fluxkit/api-client";
import { withConnectionRetry } from "./server-api-fetch";

const refused = () => new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });

describe("server API connection retry", () => {
  it.each([undefined, "GET", "HEAD"])(
    "retries %s once with the same URL and options",
    async (method) => {
      const answer = new Response(null, { status: 200 });
      const fetch = vi
        .fn<FetchLike>()
        .mockRejectedValueOnce(refused())
        .mockResolvedValueOnce(answer);
      const init = {
        method,
        cache: "no-store",
        signal: new AbortController().signal,
      } satisfies RequestInit;
      expect(await withConnectionRetry(fetch)("http://api/store/config", init)).toBe(answer);
      expect(fetch.mock.calls).toEqual([
        ["http://api/store/config", init],
        ["http://api/store/config", init],
      ]);
    },
  );

  it.each(["ECONNRESET", "EHOSTUNREACH", "UND_ERR_SOCKET"])(
    "recognizes nested %s",
    async (code) => {
      const fetch = vi
        .fn<FetchLike>()
        .mockRejectedValueOnce(
          new Error("fetch failed", {
            cause: new Error("socket", { cause: { code } }),
          }),
        )
        .mockResolvedValueOnce(new Response());
      await withConnectionRetry(fetch)("http://api/x", {});
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("recognizes undici's other side closed", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: new Error("other side closed"),
        }),
      )
      .mockResolvedValueOnce(new Response());
    await withConnectionRetry(fetch)("http://api/x", {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("does not retry %s", async (method) => {
    const error = refused();
    const fetch = vi.fn<FetchLike>().mockRejectedValue(error);
    await expect(withConnectionRetry(fetch)("http://api/x", { method })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    new DOMException("aborted", "AbortError"),
    new DOMException("timeout", "TimeoutError"),
    new Error("timeout", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
    Object.assign(new Error("aborted", { cause: refused() }), { name: "AbortError" }),
    new TypeError("unrecognized network error"),
  ])("does not retry aborts, timeouts or unknown failures: %s", async (error) => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(error);
    await expect(withConnectionRetry(fetch)("http://api/x", {})).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a connection error after the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = refused();
    const fetch = vi.fn<FetchLike>().mockRejectedValue(error);
    await expect(
      withConnectionRetry(fetch)("http://api/x", { signal: controller.signal }),
    ).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a 5xx answer without retrying", async () => {
    const answer = new Response(null, { status: 503 });
    const fetch = vi.fn<FetchLike>().mockResolvedValue(answer);
    expect(await withConnectionRetry(fetch)("http://api/x", {})).toBe(answer);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces the second failure unchanged", async () => {
    const second = refused();
    const fetch = vi.fn<FetchLike>().mockRejectedValueOnce(refused()).mockRejectedValueOnce(second);
    await expect(withConnectionRetry(fetch)("http://api/x", {})).rejects.toBe(second);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
